-- This script creates guild_config entries for ALL guilds that exist in the guilds table
-- It uses the ACTUAL guild IDs from your database

-- First, let's see what guilds you have
SELECT id, name, nickname, min_level, display_order FROM guilds ORDER BY display_order;
    
-- Create guild_config entries for each guild that doesn't already have one
-- This uses INSERT ... ON CONFLICT to safely add missing entries
INSERT INTO guild_config (guild_id, guild_name, api_key, settings, created_at)
SELECT
  g.id as guild_id,
  g.name as guild_name,
  'placeholder' as api_key,
  '{"donation_requirement": 5000}'::jsonb as settings,
  NOW() as created_at
FROM guilds g
WHERE NOT EXISTS (
  SELECT 1 FROM guild_config gc WHERE gc.guild_id = g.id
);

-- Verify all guilds now have config entries
SELECT
  g.id,
  g.name,
  g.nickname,
  CASE WHEN gc.guild_id IS NOT NULL THEN 'Yes' ELSE 'No' END as has_config
FROM guilds g
LEFT JOIN guild_config gc ON gc.guild_id = g.id
ORDER BY g.display_order;

-- Show the guild_config entries
SELECT guild_id, guild_name FROM guild_config ORDER BY guild_id;
