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
-- Hunting bow lives on the character (members) so /combat and the roster share it.
-- Name from src/lib/combat/hunting-gear.ts; separate from the combat bow slot on /combat.
ALTER TABLE members ADD COLUMN IF NOT EXISTS hunting_bow TEXT;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'assault_roster' AND column_name = 'hunting_bow') THEN
    UPDATE members m SET hunting_bow = r.hunting_bow FROM assault_roster r WHERE r.member_id = m.id AND r.hunting_bow IS NOT NULL;
    ALTER TABLE assault_roster DROP COLUMN hunting_bow;
  END IF;
END $$;

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

-- ============================================================================
-- Step 4b: potion presets carry an assault tier (0 none, 1 Bronze … 5 Dream).
-- Loadouts are rated by the best preset they match or beat (AP%, Prot%, Battle XP%, Combat XP%).
-- ============================================================================
ALTER TABLE assault_potion_presets ADD COLUMN IF NOT EXISTS assault_tier INT NOT NULL DEFAULT 0;
UPDATE assault_potion_presets SET assault_tier = 0 WHERE id = 'free';
UPDATE assault_potion_presets SET assault_tier = 1 WHERE id = 'budget';
UPDATE assault_potion_presets SET assault_tier = 4 WHERE id = 'mid';
UPDATE assault_potion_presets SET assault_tier = 5 WHERE id = 'whale';
-- Silver and Gold presets between Budget (Bronze) and Mid (Crystal).
-- Silver: Thunderfury Brew + Dragonblood Tonic + Wraithbane Essence
-- Gold:   Phoenix Ashes + Dragonblood Tonic + Wraithbane Essence
INSERT INTO assault_potion_presets (id, label, description, sort_order, combat_potion_ids, xp_potion_ids, assault_tier) VALUES
  ('silver', 'Silver', 'Budget with a real Battle XP potion: Thunderfury + Dragonblood Tonic + Wraithbane.', 3, ARRAY[11]::INT[], ARRAY[201, 103]::INT[], 2),
  ('gold', 'Gold', 'Stronger combo for faster kills: Phoenix Ashes + Dragonblood Tonic + Wraithbane.', 4, ARRAY[14]::INT[], ARRAY[201, 103]::INT[], 3)
ON CONFLICT (id) DO UPDATE SET assault_tier = EXCLUDED.assault_tier;
UPDATE assault_potion_presets SET sort_order = 1 WHERE id = 'free';
UPDATE assault_potion_presets SET sort_order = 2 WHERE id = 'budget';
UPDATE assault_potion_presets SET sort_order = 5 WHERE id = 'mid';
UPDATE assault_potion_presets SET sort_order = 6 WHERE id = 'whale';

-- ============================================================================
-- Step 5b: where a market price came from. 'vendor' = no sales or history, so the
-- price is the vendor value and can be far below what rare items really sell for.
-- The roster only suggests buys priced from 'sales' or 'history'.
-- Run BEFORE deploying: the price jobs write this column.
-- ============================================================================
ALTER TABLE market_cache ADD COLUMN IF NOT EXISTS price_source TEXT;

-- ============================================================================
-- Step 6: RSVP per assault wave. Auto members count as "in" unless they answer
-- otherwise; opt-in members only count once they answer "in".
-- ============================================================================
CREATE TABLE IF NOT EXISTS assault_rsvps (
  guild_id TEXT NOT NULL,
  wave_unix BIGINT NOT NULL,          -- launch time of the wave (unix seconds)
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('in', 'maybe', 'out')),
  source TEXT NOT NULL DEFAULT 'web' CHECK (source IN ('web', 'discord')),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  discord_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (guild_id, wave_unix, member_id)
);
CREATE INDEX IF NOT EXISTS idx_assault_rsvps_wave ON assault_rsvps(guild_id, wave_unix);
ALTER TABLE assault_rsvps ENABLE ROW LEVEL SECURITY;
