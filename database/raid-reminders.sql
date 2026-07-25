-- ============================================================================
-- Raid Reminders: minute-precise Discord pings via Supabase pg_cron
-- ============================================================================
--
-- BEFORE APPLYING:
--   1. Replace REPLACE_WITH_APP_URL with deployed Next.js URL (no trailing /).
--   2. Replace REPLACE_WITH_CRON_SECRET with same value as CRON_SECRET env var
--      in Vercel/hosting. Must match, or /api/cron/raid-reminders returns 401.
--   3. Enable pg_cron + pg_net in Supabase dashboard (Database → Extensions).
--
-- Secret sits in cron.job table. Readable only by superuser/service_role.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE TABLE IF NOT EXISTS raid_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  time_utc TIME NOT NULL,
  discord_channel_id TEXT NOT NULL,
  message TEXT NOT NULL,
  role_ping_id TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_raid_reminders_time
  ON raid_reminders(time_utc) WHERE enabled;

-- Unschedule previous version, if any
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'raid-reminders-tick') THEN
    PERFORM cron.unschedule('raid-reminders-tick');
  END IF;
END $$;

SELECT cron.schedule(
  'raid-reminders-tick',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://guild-tracker-9ys7.vercel.app/api/cron/raid-reminders',
    headers := jsonb_build_object(
      'Authorization', 'Bearer REPLACE_WITH_CRON_SECRET',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
