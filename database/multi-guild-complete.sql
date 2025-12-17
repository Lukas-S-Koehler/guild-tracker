-- ============================================
-- Complete Multi-Guild Migration
-- This creates a proper multi-guild system where:
-- - Guilds are pre-defined with nicknames
-- - Members can switch guilds but retain history
-- - Leaderboards work across all guilds
-- ============================================

-- ============================================
-- 1. Create guilds table
-- ============================================

CREATE TABLE IF NOT EXISTS guilds (
  id TEXT PRIMARY KEY,  -- Using min_level as ID (111, 171, etc)
  name TEXT NOT NULL UNIQUE,
  nickname TEXT NOT NULL UNIQUE,  -- DB, DI, DT, etc
  min_level INTEGER NOT NULL,
  display_order INTEGER NOT NULL,  -- For consistent sorting
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed all Dream guilds
INSERT INTO guilds (id, name, nickname, min_level, display_order) VALUES
  ('111', 'Dream Team', 'DT', 111, 1),
  ('171', 'Dream Raiders', 'DR', 171, 2),
  ('138', 'Dream Invaders', 'DI', 138, 3),
  ('292', 'Dream Guardians', 'DG', 292, 4),
  ('735', 'Dream Undead', 'DU', 735, 5),
  ('751', 'Dream Warriors', 'DW', 751, 6),
  ('785', 'Dream Chasers', 'DC', 785, 7),
  ('554', 'Dream Bandits', 'DB', 554, 8),
  ('845', 'Dream Paladins', 'DP', 845, 9),
  ('1106', 'Dream Angels', 'DA', 1106, 10),
  ('576', 'Cursed Dreamers', 'CD', 576, 11)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  nickname = EXCLUDED.nickname,
  min_level = EXCLUDED.min_level,
  display_order = EXCLUDED.display_order;

-- ============================================
-- 2. Backup existing members table
-- ============================================

-- Create backup just in case
CREATE TABLE IF NOT EXISTS members_backup AS SELECT * FROM members;

-- ============================================
-- 3. Drop old constraints on members
-- ============================================

-- Drop old unique constraint on ign (if exists)
ALTER TABLE members DROP CONSTRAINT IF EXISTS members_ign_key;
ALTER TABLE members DROP CONSTRAINT IF EXISTS members_guild_ign_unique;
ALTER TABLE members DROP CONSTRAINT IF EXISTS members_guild_idlemmo_unique;

-- ============================================
-- 4. Modify members table structure
-- ============================================

-- Add current_guild_id if not exists
ALTER TABLE members ADD COLUMN IF NOT EXISTS current_guild_id TEXT;

-- Migrate existing guild_id to current_guild_id
UPDATE members SET current_guild_id = guild_id WHERE current_guild_id IS NULL AND guild_id IS NOT NULL;

-- Add foreign key to guilds
ALTER TABLE members DROP CONSTRAINT IF EXISTS fk_members_guild;
ALTER TABLE members DROP CONSTRAINT IF EXISTS fk_members_current_guild;
ALTER TABLE members
ADD CONSTRAINT fk_members_current_guild
FOREIGN KEY (current_guild_id) REFERENCES guilds(id) ON DELETE SET NULL;

-- Add idlemmo_id as unique identifier for members
-- This allows same IGN across guilds but tracks same person
ALTER TABLE members ADD COLUMN IF NOT EXISTS idlemmo_id TEXT;

-- Populate idlemmo_id from existing data (lowercase ign as fallback)
UPDATE members
SET idlemmo_id = COALESCE(idlemmo_id, LOWER(ign))
WHERE idlemmo_id IS NULL;

-- Make idlemmo_id unique (one person = one member record)
CREATE UNIQUE INDEX IF NOT EXISTS idx_members_idlemmo_unique ON members(idlemmo_id);

-- Add indexes for current_guild_id
CREATE INDEX IF NOT EXISTS idx_members_current_guild ON members(current_guild_id);
CREATE INDEX IF NOT EXISTS idx_members_guild_ign ON members(current_guild_id, ign);

-- ============================================
-- 5. Create member_guild_history table
-- ============================================

CREATE TABLE IF NOT EXISTS member_guild_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  left_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Prevent duplicate active memberships
CREATE UNIQUE INDEX IF NOT EXISTS idx_member_guild_active
ON member_guild_history(member_id, guild_id)
WHERE left_at IS NULL;

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_member_guild_history_member ON member_guild_history(member_id);
CREATE INDEX IF NOT EXISTS idx_member_guild_history_guild ON member_guild_history(guild_id);

-- Populate history from existing members
INSERT INTO member_guild_history (member_id, guild_id, joined_at, left_at)
SELECT
  id,
  current_guild_id,
  COALESCE(first_seen, created_at, NOW()),
  NULL  -- Still active
FROM members
WHERE current_guild_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- ============================================
-- 6. Update guild_config table
-- ============================================

-- Add guild_id reference to guilds table
ALTER TABLE guild_config DROP CONSTRAINT IF EXISTS guild_config_guild_id_fkey;
ALTER TABLE guild_config
ADD CONSTRAINT fk_guild_config_guild
FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE CASCADE;

-- ============================================
-- 7. Update daily_logs to preserve member history
-- ============================================

-- Add guild_id to daily_logs to track which guild they were in at the time
ALTER TABLE daily_logs ADD COLUMN IF NOT EXISTS guild_id TEXT;

-- Populate guild_id from members' current guild
UPDATE daily_logs dl
SET guild_id = m.current_guild_id
FROM members m
WHERE dl.member_id = m.id AND dl.guild_id IS NULL;

-- Add foreign key
ALTER TABLE daily_logs
ADD CONSTRAINT fk_daily_logs_guild
FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE SET NULL;

-- Add index
CREATE INDEX IF NOT EXISTS idx_daily_logs_guild ON daily_logs(guild_id);

-- ============================================
-- 8. Update donations table
-- ============================================

-- Add guild_id to donations
ALTER TABLE donations ADD COLUMN IF NOT EXISTS guild_id TEXT;

-- Populate from daily_logs
UPDATE donations don
SET guild_id = dl.guild_id
FROM daily_logs dl
WHERE don.daily_log_id = dl.id AND don.guild_id IS NULL;

-- Add foreign key
ALTER TABLE donations
ADD CONSTRAINT fk_donations_guild
FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE SET NULL;

-- Add index
CREATE INDEX IF NOT EXISTS idx_donations_guild ON donations(guild_id);

-- ============================================
-- 9. Create helper functions
-- ============================================

-- Function to move a member to a new guild
CREATE OR REPLACE FUNCTION move_member_to_guild(
  p_member_id UUID,
  p_new_guild_id TEXT
)
RETURNS VOID AS $$
DECLARE
  v_old_guild_id TEXT;
BEGIN
  -- Get current guild
  SELECT current_guild_id INTO v_old_guild_id
  FROM members
  WHERE id = p_member_id;

  -- Close previous guild membership if exists
  IF v_old_guild_id IS NOT NULL THEN
    UPDATE member_guild_history
    SET left_at = NOW()
    WHERE member_id = p_member_id
      AND guild_id = v_old_guild_id
      AND left_at IS NULL;
  END IF;

  -- Update member's current guild
  UPDATE members
  SET current_guild_id = p_new_guild_id,
      synced_at = NOW()
  WHERE id = p_member_id;

  -- Create new guild membership record
  INSERT INTO member_guild_history (member_id, guild_id, joined_at)
  VALUES (p_member_id, p_new_guild_id, NOW())
  ON CONFLICT DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- Function to get member with guild info
CREATE OR REPLACE FUNCTION get_members_with_guild()
RETURNS TABLE (
  id UUID,
  ign TEXT,
  idlemmo_id TEXT,
  current_guild_id TEXT,
  guild_name TEXT,
  guild_nickname TEXT,
  "position" INTEGER,  -- Quoted because it's a reserved keyword
  total_level INTEGER,
  avatar_url TEXT,
  is_active BOOLEAN,
  first_seen DATE,
  last_seen DATE
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.id,
    m.ign,
    m.idlemmo_id,
    m.current_guild_id,
    g.name AS guild_name,
    g.nickname AS guild_nickname,
    m."position",
    m.total_level,
    m.avatar_url,
    m.is_active,
    m.first_seen,
    m.last_seen
  FROM members m
  LEFT JOIN guilds g ON g.id = m.current_guild_id
  ORDER BY g.display_order, m."position";
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 10. Update RLS policies
-- ============================================

-- Enable RLS on new tables
ALTER TABLE guilds ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_guild_history ENABLE ROW LEVEL SECURITY;

-- Guilds are public (everyone can see all guilds)
DROP POLICY IF EXISTS "Guilds are public" ON guilds;
CREATE POLICY "Guilds are public"
  ON guilds FOR SELECT
  USING (true);

-- Users can view guild history for members in their guilds
DROP POLICY IF EXISTS "Users can view member guild history" ON member_guild_history;
CREATE POLICY "Users can view member guild history"
  ON member_guild_history FOR SELECT
  USING (
    guild_id IN (
      SELECT guild_id FROM guild_members WHERE user_id = auth.uid()
    )
  );

-- Officers and leaders can manage guild history
DROP POLICY IF EXISTS "Officers can manage guild history" ON member_guild_history;
CREATE POLICY "Officers can manage guild history"
  ON member_guild_history FOR ALL
  USING (
    guild_id IN (
      SELECT guild_id FROM guild_members
      WHERE user_id = auth.uid() AND role IN ('OFFICER', 'LEADER')
    )
  );

-- Update members policy to allow viewing across guilds (for leaderboard)
DROP POLICY IF EXISTS "Users can view members" ON members;
CREATE POLICY "Users can view members"
  ON members FOR SELECT
  USING (
    current_guild_id IN (
      SELECT guild_id FROM guild_members WHERE user_id = auth.uid()
    )
    OR
    -- Allow viewing all members for leaderboard if user is in any Dream guild
    auth.uid() IN (SELECT user_id FROM guild_members WHERE guild_id LIKE '%')
  );

-- ============================================
-- 11. Create views for common queries
-- ============================================

-- View for cross-guild leaderboard
CREATE OR REPLACE VIEW v_global_leaderboard AS
SELECT
  m.id,
  m.ign,
  g.nickname AS guild_nickname,
  g.name AS guild_name,
  m.current_guild_id,
  COALESCE(SUM(dl.raids), 0) AS total_raids,
  COALESCE(SUM(dl.gold_donated), 0) AS total_gold,
  COALESCE(SUM(dl.raids), 0) * 1000 + COALESCE(SUM(dl.gold_donated), 0) AS activity_score,
  COUNT(DISTINCT dl.log_date) AS days_active
FROM members m
LEFT JOIN guilds g ON g.id = m.current_guild_id
LEFT JOIN daily_logs dl ON dl.member_id = m.id
WHERE m.is_active = true
GROUP BY m.id, m.ign, g.nickname, g.name, m.current_guild_id
ORDER BY activity_score DESC;

-- View for weekly leaderboard
CREATE OR REPLACE VIEW v_weekly_leaderboard AS
SELECT
  m.id,
  m.ign,
  g.nickname AS guild_nickname,
  g.name AS guild_name,
  m.current_guild_id,
  COALESCE(SUM(dl.raids), 0) AS total_raids,
  COALESCE(SUM(dl.gold_donated), 0) AS total_gold,
  COALESCE(SUM(dl.raids), 0) * 1000 + COALESCE(SUM(dl.gold_donated), 0) AS activity_score,
  COUNT(DISTINCT dl.log_date) AS days_active
FROM members m
LEFT JOIN guilds g ON g.id = m.current_guild_id
LEFT JOIN daily_logs dl ON dl.member_id = m.id
WHERE m.is_active = true
  AND dl.log_date >= CURRENT_DATE - INTERVAL '7 days'
GROUP BY m.id, m.ign, g.nickname, g.name, m.current_guild_id
ORDER BY activity_score DESC;

-- View for monthly leaderboard
CREATE OR REPLACE VIEW v_monthly_leaderboard AS
SELECT
  m.id,
  m.ign,
  g.nickname AS guild_nickname,
  g.name AS guild_name,
  m.current_guild_id,
  COALESCE(SUM(dl.raids), 0) AS total_raids,
  COALESCE(SUM(dl.gold_donated), 0) AS total_gold,
  COALESCE(SUM(dl.raids), 0) * 1000 + COALESCE(SUM(dl.gold_donated), 0) AS activity_score,
  COUNT(DISTINCT dl.log_date) AS days_active
FROM members m
LEFT JOIN guilds g ON g.id = m.current_guild_id
LEFT JOIN daily_logs dl ON dl.member_id = m.id
WHERE m.is_active = true
  AND dl.log_date >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY m.id, m.ign, g.nickname, g.name, m.current_guild_id
ORDER BY activity_score DESC;

-- ============================================
-- Done!
-- ============================================

-- Summary of changes:
-- 1. ✅ Created guilds table with all 11 Dream guilds
-- 2. ✅ Updated members to use current_guild_id (can switch guilds)
-- 3. ✅ Added idlemmo_id to track same person across guilds
-- 4. ✅ Created member_guild_history to track movements
-- 5. ✅ Added guild_id to daily_logs and donations (preserves history)
-- 6. ✅ Created helper functions for guild switching
-- 7. ✅ Created views for cross-guild leaderboards
-- 8. ✅ Updated RLS policies for multi-guild access

-- Next steps:
-- 1. Update API routes to use new schema
-- 2. Update UI to display guild nicknames
-- 3. Update leaderboard to use views with filtering
-- 4. Test member syncing with new guild structure
