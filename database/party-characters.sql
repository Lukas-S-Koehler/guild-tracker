-- ============================================================================
-- Dream Hub step 16b: party members are CHARACTERS, not Discord users.
-- One person can put several alts in a party (each a row), and a character can be in
-- only one open party at a time (checked in src/lib/party-discord.ts).
-- Existing rows: the character is filled in when the Discord user has exactly one active
-- character; otherwise ign stays NULL ("character not set") until /party invite ign: sets it.
-- Depends on: database/party-finder.sql. Safe to re-run.
-- ============================================================================

ALTER TABLE party_members ADD COLUMN IF NOT EXISTS id UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE party_members ADD COLUMN IF NOT EXISTS ign TEXT;
ALTER TABLE party_members ADD COLUMN IF NOT EXISTS member_id UUID REFERENCES members(id) ON DELETE SET NULL;
ALTER TABLE party_members DROP CONSTRAINT IF EXISTS party_members_pkey;
ALTER TABLE party_members ADD PRIMARY KEY (id);
ALTER TABLE party_members ALTER COLUMN discord_id DROP NOT NULL;

UPDATE party_members pm
SET ign = one.ign, member_id = one.id
FROM (
  SELECT discord_id, (array_agg(ign))[1] AS ign, (array_agg(id))[1] AS id
  FROM members
  WHERE is_active AND discord_id IS NOT NULL
  GROUP BY discord_id
  HAVING COUNT(*) = 1
) one
WHERE pm.ign IS NULL AND pm.discord_id = one.discord_id;

CREATE UNIQUE INDEX IF NOT EXISTS party_members_party_ign ON party_members(party_id, lower(ign)) WHERE ign IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_party_members_ign ON party_members(lower(ign));
