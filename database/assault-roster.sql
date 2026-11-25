-- ============================================================================
-- Assault Roster (docs/assault-roster.md), step 2: one API snapshot per character
-- currently in an assault guild (guilds.is_assault: DE, DI). Filled by
-- /api/cron/assault-roster (daily) and the staff/owner refresh on /assault/roster.
-- Depends on: members, guilds. Safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS assault_roster (
  member_id UUID PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  guild_id TEXT NOT NULL,
  hashed_id TEXT NOT NULL,
  ign TEXT NOT NULL,
  character_class TEXT,
  image_url TEXT,
  stats JSONB,
  skills JSONB,
  equipped_pet JSONB,
  pets JSONB NOT NULL DEFAULT '[]'::jsonb,
  effects JSONB NOT NULL DEFAULT '[]'::jsonb,
  location JSONB,
  -- true when the last sync could not see pets (hidden in game settings); pets keeps the last known list
  pets_hidden BOOLEAN NOT NULL DEFAULT FALSE,
  -- 'own' = read with the owner's API key, 'shared' = super admin fallback
  key_source TEXT,
  last_error TEXT,
  last_sync TIMESTAMPTZ,      -- last successful snapshot
  last_attempt TIMESTAMPTZ,   -- last try (success or not); the sync works stalest-attempt first
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_assault_roster_guild ON assault_roster(guild_id);
CREATE INDEX IF NOT EXISTS idx_assault_roster_attempt ON assault_roster(last_attempt NULLS FIRST);

-- Server-side only (service role); no client policies.
ALTER TABLE assault_roster ENABLE ROW LEVEL SECURITY;
