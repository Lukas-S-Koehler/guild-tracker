-- ============================================================================
-- Discord live messages (Dream Hub step 7)
-- ============================================================================
-- One row per bot-managed Discord post that the site keeps up to date
-- (guild directory, raid schedule, links hub, daily kick board, per-guild
-- inactivity reports). The bot edits the tracked messages in place, or
-- deletes and reposts them (mode decided in code per key), so channels never
-- pile up duplicates. Written only with the service role (API routes, crons).
-- ============================================================================

CREATE TABLE IF NOT EXISTS discord_live_messages (
  key               TEXT PRIMARY KEY,           -- e.g. 'guild-directory', 'inactivity:111'
  channel_id        TEXT NOT NULL,
  message_ids       TEXT[] NOT NULL DEFAULT '{}',
  content_hash      TEXT,                       -- sha256 of the last published payloads
  payloads          JSONB,                      -- last published payloads (lets admins republish)
  enabled           BOOLEAN NOT NULL DEFAULT TRUE,
  last_published_at TIMESTAMPTZ,
  last_error        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE discord_live_messages ENABLE ROW LEVEL SECURITY;
-- No policies: only the service role (which bypasses RLS) reads or writes.
