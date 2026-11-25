-- Assault roster v2 (2026-11-25): leader setup help + self-serve participation.
-- Run once in the Supabase SQL editor BEFORE deploying. Safe to re-run.

-- Potion preset a leader sets for a character that has no own default loadout yet.
-- NULL = the Mid preset (default for everyone). Their own saved loadout always wins.
ALTER TABLE assault_roster ADD COLUMN IF NOT EXISTS provisional_preset TEXT;
ALTER TABLE assault_roster ADD COLUMN IF NOT EXISTS provisional_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Gear a leader entered for an UNCLAIMED character (no /combat profile to save to).
-- Seeds their /combat gear once they claim the character and open it, then is cleared.
ALTER TABLE assault_roster ADD COLUMN IF NOT EXISTS staff_gear JSONB;

-- Participation is now picked by the owner too (auto / opt_in / none); staff can still set it.
-- none = not in by default; answering "in" for a wave counts for that wave only.
COMMENT ON COLUMN assault_roster.participation IS 'auto = in unless they say out · opt_in = in only when they say so · none = out unless they say in for a wave. Owner or guild staff.';
