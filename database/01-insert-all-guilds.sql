-- Insert all 11 Dream guilds into guilds table
-- These must exist before adding guild members
-- Uses ON CONFLICT to safely handle existing guilds

INSERT INTO guilds (id, name, nickname, min_level, display_order, created_at) VALUES
  ('500', 'Dream Team', 'DT', 500, 1, NOW()),
  ('525', 'Dream Realm', 'DR', 525, 2, NOW()),
  ('550', 'Dream Island', 'DI', 550, 3, NOW()),
  ('575', 'Dream Seekers', 'DS', 575, 4, NOW()),
  ('600', 'Dream Crafters', 'DC', 600, 5, NOW()),
  ('625', 'Dream Builders', 'DB', 625, 6, NOW()),
  ('650', 'Dream Voyagers', 'DV', 650, 7, NOW()),
  ('675', 'Dream Chasers', 'DCH', 675, 8, NOW()),
  ('700', 'Dream Legends', 'DL', 700, 9, NOW()),
  ('750', 'Dream Immortals', 'DIM', 750, 10, NOW()),
  ('785', 'Dream Angels', 'DA', 785, 11, NOW())
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  nickname = EXCLUDED.nickname,
  min_level = EXCLUDED.min_level,
  display_order = EXCLUDED.display_order;

-- Create guild_config entries for each guild (required for foreign key constraint)
-- API keys will be added by members individually in their member_keys
INSERT INTO guild_config (guild_id, guild_name, api_key, settings, created_at) VALUES
  ('500', 'Dream Team', 'placeholder', '{"donation_requirement": 5000}'::jsonb, NOW()),
  ('525', 'Dream Realm', 'placeholder', '{"donation_requirement": 5000}'::jsonb, NOW()),
  ('550', 'Dream Island', 'placeholder', '{"donation_requirement": 5000}'::jsonb, NOW()),
  ('575', 'Dream Seekers', 'placeholder', '{"donation_requirement": 5000}'::jsonb, NOW()),
  ('600', 'Dream Crafters', 'placeholder', '{"donation_requirement": 5000}'::jsonb, NOW()),
  ('625', 'Dream Builders', 'placeholder', '{"donation_requirement": 5000}'::jsonb, NOW()),
  ('650', 'Dream Voyagers', 'placeholder', '{"donation_requirement": 5000}'::jsonb, NOW()),
  ('675', 'Dream Chasers', 'placeholder', '{"donation_requirement": 5000}'::jsonb, NOW()),
  ('700', 'Dream Legends', 'placeholder', '{"donation_requirement": 5000}'::jsonb, NOW()),
  ('750', 'Dream Immortals', 'placeholder', '{"donation_requirement": 5000}'::jsonb, NOW()),
  ('785', 'Dream Angels', 'placeholder', '{"donation_requirement": 5000}'::jsonb, NOW())
ON CONFLICT (guild_id) DO UPDATE SET
  guild_name = EXCLUDED.guild_name,
  settings = EXCLUDED.settings;

-- Verify guilds were created
SELECT id, name, nickname, min_level FROM guilds ORDER BY display_order;

-- Now you can add guild members!
-- Example:
-- INSERT INTO guild_members (guild_id, user_id, role, joined_at)
-- VALUES ('785', 'your-user-uuid', 'LEADER', NOW());
