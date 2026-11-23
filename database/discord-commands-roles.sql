-- ============================================================================
-- Dream Hub step 8: Discord commands + role sync
--
-- * user_discord_links : website user ↔ Discord account (one each way). Created by
--                        /claim in Discord → signed link → /account/discord on the site.
--                        When members.discord_id already matches (staff /map), the claim
--                        is approved automatically (A5).
-- * away_periods       : /away holidays. member_ids = the whole account bundle at the time
--                        of the request. Active periods skip the inactivity check; after the
--                        end date, inactivity counts from the end date (no instant kick).
-- * discord_role_keeps : roles the role sync must never remove from a person (e.g. assault
--                        staff who are not officers in game). Managed from Admin → Discord → Role sync.
-- Depends on: auth.users, members
-- Safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_discord_links (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  discord_id TEXT NOT NULL UNIQUE,
  discord_username TEXT,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE user_discord_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_discord_links_own_read" ON user_discord_links;
CREATE POLICY "user_discord_links_own_read" ON user_discord_links
  FOR SELECT USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS away_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_id TEXT NOT NULL,
  member_ids UUID[] NOT NULL,
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  reason TEXT,
  created_by_discord_id TEXT,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_on >= starts_on)
);
CREATE INDEX IF NOT EXISTS idx_away_periods_discord ON away_periods(discord_id);
CREATE INDEX IF NOT EXISTS idx_away_periods_ends ON away_periods(ends_on);
ALTER TABLE away_periods ENABLE ROW LEVEL SECURITY;
-- Service role only.

CREATE TABLE IF NOT EXISTS discord_role_keeps (
  discord_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (discord_id, role_id)
);
ALTER TABLE discord_role_keeps ENABLE ROW LEVEL SECURITY;
-- Service role only.
