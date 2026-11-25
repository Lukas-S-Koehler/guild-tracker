-- ============================================================================
-- Assault eligibility (docs/assault-roster.md §10): claimed characters outside the
-- assault guilds measured against each assault guild's roster goals.
-- Depends on: members, recruit_prospects (database/recruit-prospects.sql).
-- Run manually in the Supabase SQL editor before deploying. Safe to re-run.
-- ============================================================================

-- One API snapshot per character (same fields as assault_roster), kept apart so the rosters stay clean.
-- Filled on demand from /assault/eligibility (refresh when older than 6 h, manual refresh 2 min
-- cooldown) and by the daily assault-roster cron once the rosters are done.
-- member_id is null for staff IGN lookups of players who aren't in our members table (phase 2).
CREATE TABLE IF NOT EXISTS assault_eligibility_snapshots (
  hashed_id TEXT PRIMARY KEY,
  member_id UUID REFERENCES members(id) ON DELETE CASCADE,
  ign TEXT NOT NULL,
  character_class TEXT,
  image_url TEXT,
  stats JSONB,
  skills JSONB,
  equipped_pet JSONB,
  pets JSONB NOT NULL DEFAULT '[]'::jsonb,
  effects JSONB NOT NULL DEFAULT '[]'::jsonb,
  location JSONB,
  pets_hidden BOOLEAN NOT NULL DEFAULT FALSE,
  key_source TEXT,                 -- 'own' | 'shared'
  -- Per assault guild: { "<guild id>": { meets, setup[], tiers{track: 0-5}, below[], move, zone } }.
  -- Written whenever the rows are built, so the staff scouting list needs no recompute.
  verdicts JSONB NOT NULL DEFAULT '{}'::jsonb,
  verdicts_at TIMESTAMPTZ,
  last_error TEXT,
  last_sync TIMESTAMPTZ,
  last_attempt TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_assault_elig_member ON assault_eligibility_snapshots(member_id) WHERE member_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_assault_elig_attempt ON assault_eligibility_snapshots(last_attempt NULLS FIRST);

-- Server-side only (service role); no client policies.
ALTER TABLE assault_eligibility_snapshots ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- Join interest → the shared Recruiting list (Admin → Recruiting).
-- "interested" = the player said so on /assault/eligibility (or /eligibility in Discord).
-- ============================================================================
ALTER TABLE recruit_prospects DROP CONSTRAINT IF EXISTS recruit_prospects_status_check;
ALTER TABLE recruit_prospects ADD CONSTRAINT recruit_prospects_status_check
  CHECK (status IN ('interested', 'messaged', 'replied', 'joined', 'declined', 'skip_guild', 'skip_weak'));
ALTER TABLE recruit_prospects ADD COLUMN IF NOT EXISTS interest_guild_id TEXT;      -- assault guild they want to join
ALTER TABLE recruit_prospects ADD COLUMN IF NOT EXISTS interest_member_id UUID REFERENCES members(id) ON DELETE SET NULL;
ALTER TABLE recruit_prospects ADD COLUMN IF NOT EXISTS interest_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE recruit_prospects ADD COLUMN IF NOT EXISTS interest_tiers JSONB;        -- verdict for that guild at the time
ALTER TABLE recruit_prospects ADD COLUMN IF NOT EXISTS interest_at TIMESTAMPTZ;
