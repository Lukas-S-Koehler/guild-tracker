-- Dream Hub step 10: personal assault page (/me/assault) + season recap.
-- Safe to re-run.

-- One pinned /combat setup per user, shown on /me/assault.
ALTER TABLE combat_setups ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS idx_combat_setups_pinned
  ON combat_setups(user_id) WHERE pinned;

-- Season recaps already posted (one per guild per season end), so the daily cron posts each once.
CREATE TABLE IF NOT EXISTS assault_season_recaps (
  guild_id TEXT NOT NULL,
  season_end DATE NOT NULL,
  season_number INT,
  message_id TEXT,
  posted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (guild_id, season_end)
);
ALTER TABLE assault_season_recaps ENABLE ROW LEVEL SECURITY;
