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

-- ============================================================================
-- Step 3: roster flags + admin-added pets. Safe to re-run.
-- ============================================================================

-- Assault participation:
--   auto   = always in (counted for every wave unless they say otherwise)
--   opt_in = chooses per assault (RSVP)
--   none   = in the guild for boosts/pools only; not measured on goals. Staff only.
ALTER TABLE assault_roster ADD COLUMN IF NOT EXISTS participation TEXT NOT NULL DEFAULT 'auto';
ALTER TABLE assault_roster DROP CONSTRAINT IF EXISTS assault_roster_participation_check;
ALTER TABLE assault_roster ADD CONSTRAINT assault_roster_participation_check CHECK (participation IN ('auto', 'opt_in', 'none'));
ALTER TABLE assault_roster ADD COLUMN IF NOT EXISTS participation_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
-- Earlier draft used a non_assaulter flag: carry it over, then drop it.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'assault_roster' AND column_name = 'non_assaulter') THEN
    UPDATE assault_roster SET participation = 'none' WHERE non_assaulter;
    ALTER TABLE assault_roster DROP COLUMN non_assaulter;
    ALTER TABLE assault_roster DROP COLUMN IF EXISTS non_assaulter_by;
  END IF;
END $$;
-- Hunting bow (separate from the combat bow on /combat); name from src/lib/combat/hunting-gear.ts.
ALTER TABLE assault_roster ADD COLUMN IF NOT EXISTS hunting_bow TEXT;

-- Pets added in Admin → System → Pets (pasted from the in-game stats panel).
-- Code-defined pets in src/lib/combat/pet-data.ts win over rows here with the same name.
CREATE TABLE IF NOT EXISTS custom_pets (
  name TEXT PRIMARY KEY,
  quality TEXT NOT NULL,
  -- { agility, accuracy, protection, attackPower, moveSpeed, stamina, maxHealth, critChance, critDamage: { base, perLevel } }
  stats JSONB NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE custom_pets DROP CONSTRAINT IF EXISTS custom_pets_quality_check;
ALTER TABLE custom_pets ADD CONSTRAINT custom_pets_quality_check
  CHECK (quality IN ('Standard', 'Refined', 'Premium', 'Epic', 'Event', 'Legendary', 'Mythic'));
ALTER TABLE custom_pets ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- Step 4: goal tiers per assault guild (Admin → Assault → Roster goals). Safe to re-run.
-- goals = { tracks: { <track>: { thresholds: [bronze, silver, gold, crystal|null], required: 0-4 } } }
-- Missing tracks fall back to the defaults in src/lib/roster-goals.ts.
-- ============================================================================
CREATE TABLE IF NOT EXISTS assault_roster_goals (
  guild_id TEXT PRIMARY KEY,
  goals JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE assault_roster_goals ENABLE ROW LEVEL SECURITY;
