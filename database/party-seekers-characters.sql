-- ============================================================================
-- Dream Hub step 16c: /lfg lists CHARACTERS (a person can list several alts).
-- party_seekers was empty when this was written (2026-11-24), so it is rebuilt.
-- Depends on: database/party-finder.sql. Safe to re-run (drops and recreates party_seekers).
-- ============================================================================

DROP TABLE IF EXISTS party_seekers;

CREATE TABLE party_seekers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_id TEXT NOT NULL,
  ign TEXT NOT NULL CHECK (char_length(ign) BETWEEN 1 AND 40),
  member_id UUID REFERENCES members(id) ON DELETE SET NULL,
  skills TEXT[] NOT NULL DEFAULT '{}',
  note TEXT CHECK (note IS NULL OR char_length(note) <= 200),
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS party_seekers_ign ON party_seekers(lower(ign));
CREATE INDEX IF NOT EXISTS idx_party_seekers_user ON party_seekers(discord_id);

ALTER TABLE party_seekers ENABLE ROW LEVEL SECURITY;
