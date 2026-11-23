-- Dream Hub step 14 (F5): staff-made calendar events.
-- Raids and assault launches are NOT stored here: the calendar computes them from
-- src/lib/raid-discord.ts (raid times) and assault_configs (launch days/time).
--
-- An event is either one-off (starts_at) or weekly (weekdays + time_utc, optional active_from/active_until).
-- guild_id NULL = network-wide (super admin only); otherwise officer+ of that guild may edit it.

CREATE TABLE IF NOT EXISTS calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 80),
  description TEXT CHECK (description IS NULL OR char_length(description) <= 500),
  guild_id TEXT,
  kind TEXT NOT NULL DEFAULT 'event' CHECK (kind IN ('event', 'pool', 'giveaway', 'meeting', 'other')),
  -- one-off
  starts_at TIMESTAMPTZ,
  -- weekly: UTC days 0=Sun..6=Sat
  weekdays INTEGER[],
  time_utc TIME,
  active_from DATE,
  active_until DATE,
  duration_minutes INTEGER CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 1 AND 10080),
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (starts_at IS NOT NULL AND weekdays IS NULL AND time_utc IS NULL)
    OR (starts_at IS NULL AND weekdays IS NOT NULL AND cardinality(weekdays) > 0 AND time_utc IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_calendar_events_starts ON calendar_events(starts_at);
CREATE INDEX IF NOT EXISTS idx_calendar_events_guild ON calendar_events(guild_id);

ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY; -- service role only (API routes)

-- Seed: the Dream Engineers Energizing Pool (same days/time as the "DE Pool" raid reminder).
INSERT INTO calendar_events (title, description, guild_id, kind, weekdays, time_utc, duration_minutes)
SELECT 'Energizing Pool', 'Pool activated: MF / EXP boost for Dream Engineers.', '1184', 'pool', ARRAY[1,2,3,5,6], '20:00', NULL
WHERE NOT EXISTS (SELECT 1 FROM calendar_events WHERE guild_id = '1184' AND kind = 'pool');
