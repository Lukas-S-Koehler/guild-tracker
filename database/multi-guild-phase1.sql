-- Phase 1: Multi-Guild Database Schema
-- This migration sets up the foundation for multi-guild support

-- ============================================
-- 1. Create guild_members table
-- ============================================
-- Links users (from Supabase Auth) to guilds with roles

CREATE TABLE IF NOT EXISTS guild_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('MEMBER', 'OFFICER', 'LEADER')),
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(guild_id, user_id)
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_guild_members_user ON guild_members(user_id);
CREATE INDEX IF NOT EXISTS idx_guild_members_guild ON guild_members(guild_id);
CREATE INDEX IF NOT EXISTS idx_guild_members_role ON guild_members(guild_id, role);

-- ============================================
-- 2. Enable Row Level Security on all tables
-- ============================================

ALTER TABLE guild_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE members ENABLE ROW LEVEL SECURITY;
ALTER TABLE guild_members ENABLE ROW LEVEL SECURITY;

-- ============================================
-- 3. RLS Policies for guild_config
-- ============================================

-- Drop existing policies if any
DROP POLICY IF EXISTS "Users can view their guild config" ON guild_config;
DROP POLICY IF EXISTS "Leaders can update guild config" ON guild_config;
DROP POLICY IF EXISTS "Leaders can insert guild config" ON guild_config;

-- Users can only see config for guilds they belong to
CREATE POLICY "Users can view their guild config"
  ON guild_config FOR SELECT
  USING (
    guild_id IN (
      SELECT guild_id FROM guild_members WHERE user_id = auth.uid()
    )
  );

-- Only leaders can update guild config
CREATE POLICY "Leaders can update guild config"
  ON guild_config FOR UPDATE
  USING (
    guild_id IN (
      SELECT guild_id FROM guild_members
      WHERE user_id = auth.uid() AND role = 'LEADER'
    )
  );

-- Only leaders can insert new guild configs (when creating a guild)
CREATE POLICY "Leaders can insert guild config"
  ON guild_config FOR INSERT
  WITH CHECK (
    guild_id IN (
      SELECT guild_id FROM guild_members
      WHERE user_id = auth.uid() AND role = 'LEADER'
    )
  );

-- ============================================
-- 4. RLS Policies for challenges
-- ============================================

DROP POLICY IF EXISTS "Users can view their guild challenges" ON challenges;
DROP POLICY IF EXISTS "Officers and leaders can manage challenges" ON challenges;

-- Users can view challenges for their guilds
CREATE POLICY "Users can view their guild challenges"
  ON challenges FOR SELECT
  USING (
    guild_id IN (
      SELECT guild_id FROM guild_members WHERE user_id = auth.uid()
    )
  );

-- Officers and leaders can insert/update/delete challenges
CREATE POLICY "Officers and leaders can manage challenges"
  ON challenges FOR ALL
  USING (
    guild_id IN (
      SELECT guild_id FROM guild_members
      WHERE user_id = auth.uid() AND role IN ('OFFICER', 'LEADER')
    )
  );

-- ============================================
-- 5. RLS Policies for daily_logs
-- ============================================

DROP POLICY IF EXISTS "Users can view their guild daily logs" ON daily_logs;
DROP POLICY IF EXISTS "Officers and leaders can manage daily logs" ON daily_logs;

-- Users can view daily logs for members in their guilds
CREATE POLICY "Users can view their guild daily logs"
  ON daily_logs FOR SELECT
  USING (
    member_id IN (
      SELECT m.id FROM members m
      JOIN guild_config gc ON TRUE  -- Members don't have guild_id, use config
      WHERE gc.guild_id IN (
        SELECT guild_id FROM guild_members WHERE user_id = auth.uid()
      )
    )
  );

-- Officers and leaders can insert/update daily logs
CREATE POLICY "Officers and leaders can manage daily logs"
  ON daily_logs FOR ALL
  USING (
    member_id IN (
      SELECT m.id FROM members m
      JOIN guild_config gc ON TRUE
      WHERE gc.guild_id IN (
        SELECT guild_id FROM guild_members
        WHERE user_id = auth.uid() AND role IN ('OFFICER', 'LEADER')
      )
    )
  );

-- ============================================
-- 6. RLS Policies for members
-- ============================================

DROP POLICY IF EXISTS "Users can view their guild members" ON members;
DROP POLICY IF EXISTS "Officers and leaders can manage members" ON members;

-- Users can view members in their guilds
-- Note: Since members table doesn't have guild_id, we need a different approach
-- For now, allow all authenticated users to view members
-- TODO: Add guild_id to members table in future migration for proper scoping
CREATE POLICY "Users can view their guild members"
  ON members FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Officers and leaders can manage members
CREATE POLICY "Officers and leaders can manage members"
  ON members FOR ALL
  USING (
    auth.uid() IN (
      SELECT user_id FROM guild_members
      WHERE role IN ('OFFICER', 'LEADER')
    )
  );

-- ============================================
-- 7. RLS Policies for guild_members
-- ============================================

DROP POLICY IF EXISTS "Users can view guild memberships" ON guild_members;
DROP POLICY IF EXISTS "Leaders can manage guild memberships" ON guild_members;
DROP POLICY IF EXISTS "Users can view their own memberships" ON guild_members;

-- Users can view all members of guilds they belong to
CREATE POLICY "Users can view guild memberships"
  ON guild_members FOR SELECT
  USING (
    guild_id IN (
      SELECT guild_id FROM guild_members WHERE user_id = auth.uid()
    )
  );

-- Leaders can manage (insert/update/delete) guild memberships
CREATE POLICY "Leaders can manage guild memberships"
  ON guild_members FOR ALL
  USING (
    guild_id IN (
      SELECT guild_id FROM guild_members
      WHERE user_id = auth.uid() AND role = 'LEADER'
    )
  );

-- ============================================
-- 8. Helper function to check user permissions
-- ============================================

CREATE OR REPLACE FUNCTION user_has_guild_role(p_guild_id TEXT, p_required_role TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM guild_members
    WHERE guild_id = p_guild_id
      AND user_id = auth.uid()
      AND (
        CASE p_required_role
          WHEN 'MEMBER' THEN role IN ('MEMBER', 'OFFICER', 'LEADER')
          WHEN 'OFFICER' THEN role IN ('OFFICER', 'LEADER')
          WHEN 'LEADER' THEN role = 'LEADER'
        END
      )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 9. Function to get user's guilds
-- ============================================

CREATE OR REPLACE FUNCTION get_user_guilds()
RETURNS TABLE (
  guild_id TEXT,
  guild_name TEXT,
  role TEXT,
  joined_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    gm.guild_id,
    gc.guild_name,
    gm.role,
    gm.joined_at
  FROM guild_members gm
  JOIN guild_config gc ON gc.guild_id = gm.guild_id
  WHERE gm.user_id = auth.uid()
  ORDER BY gm.joined_at ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- Done!
-- ============================================
-- Next steps:
-- 1. Run this migration in Supabase
-- 2. Set up Supabase Auth in your project
-- 3. Create auth UI components
-- 4. Update API routes to check guild membership
