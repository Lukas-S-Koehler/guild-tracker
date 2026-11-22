-- Combat tool v2: keep API skills on the profile (skills.combat = real combat level,
-- skills['pet-mastery'] = pet mastery level). Run after combat-tool.sql.
ALTER TABLE combat_profiles ADD COLUMN IF NOT EXISTS skills JSONB;
