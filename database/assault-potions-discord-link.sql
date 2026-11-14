-- Link saved loadouts to a Discord user so the bot can retrieve them.
ALTER TABLE assault_potion_loadouts
  ADD COLUMN IF NOT EXISTS discord_user_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_assault_loadouts_discord_default
  ON assault_potion_loadouts(discord_user_id)
  WHERE discord_user_id IS NOT NULL AND is_default;
