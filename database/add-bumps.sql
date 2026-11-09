-- Bump tracking: single global tally across the family of guilds.
-- Users click a persistent button after bumping the ad in the main IdleMMO Discord.
-- Bot enforces 2h cooldown per Discord user.

CREATE TABLE IF NOT EXISTS bumps (
  id BIGSERIAL PRIMARY KEY,
  discord_id TEXT NOT NULL,
  discord_username TEXT,
  member_id UUID REFERENCES members(id) ON DELETE SET NULL,
  bumped_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bumps_discord_time ON bumps (discord_id, bumped_at DESC);
CREATE INDEX IF NOT EXISTS idx_bumps_time ON bumps (bumped_at DESC);

ALTER TABLE bumps ENABLE ROW LEVEL SECURITY;

CREATE POLICY bumps_service_all ON bumps FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY bumps_public_read ON bumps FOR SELECT TO anon, authenticated USING (true);

-- Global config lives in app_settings (key/value). Keys used:
--   bump_server_id              → Discord guild (server) ID where the button is posted
--   bump_channel_id             → channel where the button lives
--   bump_button_message_id      → message ID of the installed button (for reference)
--   bump_king_role_id           → role granted to monthly top bumper
--   current_bump_king_discord_id → user currently holding the role (to revoke next cycle)
