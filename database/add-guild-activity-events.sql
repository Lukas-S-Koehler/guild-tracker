-- Guild Activity Events table
-- Stores raw activity events fetched from IdleMMO API
-- Run this in Supabase SQL Editor before deploying the cron jobs

CREATE TABLE IF NOT EXISTS guild_activity_events (
  id INTEGER NOT NULL,
  guild_id TEXT NOT NULL REFERENCES guilds(id),
  type TEXT NOT NULL,
  character_hashed_id TEXT,
  character_name TEXT,
  character_avatar_url TEXT,
  event_text TEXT,
  value INTEGER,
  item_hashed_id TEXT,
  item_name TEXT,
  item_image_url TEXT,
  item_quality TEXT,
  guild_item_id INTEGER,
  guild_item_key TEXT,
  guild_item_name TEXT,
  guild_item_image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (id, guild_id)
);

CREATE INDEX IF NOT EXISTS idx_guild_activity_guild_date
  ON guild_activity_events(guild_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_guild_activity_type
  ON guild_activity_events(guild_id, type);

ALTER TABLE guild_activity_events ENABLE ROW LEVEL SECURITY;

-- Add unique constraint to donations for idempotent upserts from activity processor
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'donations_log_item_unique'
  ) THEN
    ALTER TABLE donations
      ADD CONSTRAINT donations_log_item_unique
      UNIQUE (daily_log_id, item_name);
  END IF;
END $$;

CREATE POLICY "Allow all on guild_activity_events"
  ON guild_activity_events FOR ALL USING (true);
