-- Joining state (src/lib/guild-joining.ts): a player applied, left their old guild and waits out the
-- in-game cooldown. Staff mark the character as joining a Dream guild on Admin → Recruiting; until the
-- members sync sees them there (or joining_until passes) the site treats that character as a recruit
-- of the target guild (access, Discord roles, assault roster, claims).
-- Run manually in the Supabase SQL editor BEFORE deploying.

ALTER TABLE recruit_prospects ADD COLUMN IF NOT EXISTS joining_member_id UUID REFERENCES members(id) ON DELETE SET NULL;
ALTER TABLE recruit_prospects ADD COLUMN IF NOT EXISTS joining_guild_id TEXT;
ALTER TABLE recruit_prospects ADD COLUMN IF NOT EXISTS joining_until TIMESTAMPTZ;
ALTER TABLE recruit_prospects ADD COLUMN IF NOT EXISTS joining_at TIMESTAMPTZ;
ALTER TABLE recruit_prospects ADD COLUMN IF NOT EXISTS joining_by_name TEXT;

-- One active join per character.
CREATE UNIQUE INDEX IF NOT EXISTS recruit_prospects_joining_member_uq
  ON recruit_prospects (joining_member_id) WHERE joining_member_id IS NOT NULL;
