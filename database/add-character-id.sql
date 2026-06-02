-- Add integer character_id to members (lowest = main account)
ALTER TABLE members ADD COLUMN IF NOT EXISTS character_id INTEGER;
CREATE INDEX IF NOT EXISTS members_character_id_idx ON members(character_id);

-- Add integer character_id to member_alts for alt chars
ALTER TABLE member_alts ADD COLUMN IF NOT EXISTS alt_character_id INTEGER;
