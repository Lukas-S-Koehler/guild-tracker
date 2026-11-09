-- Bump tracking: guild promotion bumps in main IdleMMO Discord.
-- Users click persistent button in guild Discord after bumping; bot enforces 2h cooldown.

CREATE TABLE IF NOT EXISTS bumps (
  id BIGSERIAL PRIMARY KEY,
  discord_id TEXT NOT NULL,
  discord_username TEXT,
  member_id UUID REFERENCES members(id) ON DELETE SET NULL,
  guild_id TEXT NOT NULL,
  bumped_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bumps_discord_time ON bumps (discord_id, bumped_at DESC);
CREATE INDEX IF NOT EXISTS idx_bumps_guild_time ON bumps (guild_id, bumped_at DESC);
CREATE INDEX IF NOT EXISTS idx_bumps_guild_discord_time ON bumps (guild_id, discord_id, bumped_at DESC);

ALTER TABLE bumps ENABLE ROW LEVEL SECURITY;

-- Service role full access
CREATE POLICY bumps_service_all ON bumps FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Public read (leaderboard surfaces publicly)
CREATE POLICY bumps_public_read ON bumps FOR SELECT TO anon, authenticated USING (true);
