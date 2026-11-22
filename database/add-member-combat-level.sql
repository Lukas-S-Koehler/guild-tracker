-- Combat level per character. The guild members endpoint only gives total_level,
-- so this is filled lazily from /v1/character/{hashed_id}/information
-- (skills.combat.level) when a member opens /me, refreshed at most once a day.
-- Guild min_level and raid requirements are combat levels, not total levels.
ALTER TABLE members ADD COLUMN IF NOT EXISTS combat_level INT;
ALTER TABLE members ADD COLUMN IF NOT EXISTS combat_level_synced_at TIMESTAMPTZ;
