-- Discord-user-keyed assault checklist state (parallel to assault_checklist_progress
-- which is keyed by auth.users.id for the web app). Discord has no auth.users row.
CREATE TABLE IF NOT EXISTS assault_checklist_discord_state (
  discord_user_id TEXT NOT NULL,
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  launch_date DATE NOT NULL,
  item_key TEXT NOT NULL,
  done_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (discord_user_id, guild_id, launch_date, item_key)
);

CREATE INDEX IF NOT EXISTS idx_assault_checklist_discord_lookup
  ON assault_checklist_discord_state(discord_user_id, guild_id, launch_date);
