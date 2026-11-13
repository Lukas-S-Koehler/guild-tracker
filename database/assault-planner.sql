-- ============================================================================
-- Assault Planner: per-guild daily assault schedule + Discord ping automation
-- ============================================================================
--
-- BEFORE APPLYING:
--   1. Replace REPLACE_WITH_APP_URL with deployed Next.js URL (no trailing /).
--   2. Replace REPLACE_WITH_CRON_SECRET with same value as CRON_SECRET env var.
--   3. pg_cron + pg_net must already be enabled (raid-reminders also uses them).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Per-guild assault config
CREATE TABLE IF NOT EXISTS assault_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id TEXT NOT NULL UNIQUE REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  active BOOLEAN NOT NULL DEFAULT FALSE,
  launch_time_utc TIME NOT NULL DEFAULT '18:00:00',
  -- Zone loadout
  zone_name TEXT NOT NULL DEFAULT 'Isle of Whispers',
  level_range TEXT NOT NULL DEFAULT '92-99',
  shrine_info TEXT NOT NULL DEFAULT 'On-site Shrine',
  target_mob_count TEXT NOT NULL DEFAULT '4,000-10,000 + 20% flee buffer',
  -- Ordered list of enemies: [{"name":"Basilisk","level":92,"gold_per_hr":12113}]
  enemy_priority JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Discord mapping (per guild)
  discord_guild_id TEXT,
  announcement_channel_id TEXT,
  member_role_id TEXT,
  staff_role_id TEXT,
  -- Scheduler overrides
  skip_date DATE,
  paused_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assault_configs_active
  ON assault_configs(active) WHERE active;

-- Ping timeline steps
CREATE TABLE IF NOT EXISTS assault_ping_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  step_key TEXT NOT NULL,
  label TEXT NOT NULL,
  offset_minutes INT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  mention_roles TEXT[] NOT NULL DEFAULT '{}',
  message_template TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (guild_id, step_key)
);

CREATE INDEX IF NOT EXISTS idx_assault_steps_guild
  ON assault_ping_steps(guild_id);

-- Restart-safe dedup log
CREATE TABLE IF NOT EXISTS assault_sent_pings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id TEXT NOT NULL,
  step_id UUID NOT NULL REFERENCES assault_ping_steps(id) ON DELETE CASCADE,
  launch_date DATE NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  discord_message_id TEXT,
  UNIQUE (guild_id, step_id, launch_date)
);

CREATE INDEX IF NOT EXISTS idx_assault_sent_pings_lookup
  ON assault_sent_pings(guild_id, launch_date);

-- Unschedule prior version if any
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'assault-scheduler-tick') THEN
    PERFORM cron.unschedule('assault-scheduler-tick');
  END IF;
END $$;

SELECT cron.schedule(
  'assault-scheduler-tick',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'REPLACE_WITH_APP_URL/api/cron/assault-scheduler',
    headers := jsonb_build_object(
      'Authorization', 'Bearer REPLACE_WITH_CRON_SECRET',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
