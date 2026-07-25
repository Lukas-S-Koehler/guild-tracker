-- ============================================================================
-- Raid Reminders: minute-precise Discord pings via Supabase pg_cron
-- ============================================================================
--
-- BEFORE APPLYING:
--   1. Set the deployed app URL in the cron.schedule() call below.
--   2. Set the CRON_SECRET in postgres config so pg_cron can authenticate:
--        ALTER DATABASE postgres SET app.cron_secret = 'YOUR_CRON_SECRET_HERE';
--        SELECT pg_reload_conf();
--   3. pg_cron + pg_net must be enabled in Supabase dashboard
--      (Database → Extensions).
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

-- Unschedule any previous version, then re-schedule
SELECT cron.unschedule('raid-reminders-tick')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'raid-reminders-tick');

SELECT cron.schedule(
  'raid-reminders-tick',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://REPLACE_WITH_APP_URL/api/cron/raid-reminders',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.cron_secret', true),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
