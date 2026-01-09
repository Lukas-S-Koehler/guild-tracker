-- Add Dream Engineers guild to the guilds table
INSERT INTO guilds (id, name, nickname, min_level, display_order)
VALUES ('1184', 'Dream Engineers', 'DE', 1184, 12)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  nickname = EXCLUDED.nickname,
  min_level = EXCLUDED.min_level,
  display_order = EXCLUDED.display_order;

-- Create guild_config entry for Dream Engineers
INSERT INTO "public"."guild_config" ("id", "guild_id", "guild_name", "api_key", "last_member_sync", "settings", "created_at", "updated_at", "donation_requirement")
VALUES (
  gen_random_uuid(),
  '1184',
  'Dream Engineers',
  'placeholder',
  null,
  '{"donation_requirement":5000}',
  NOW(),
  NOW(),
  '5000'
)
ON CONFLICT (guild_id) DO NOTHING;

-- Verify the guild was added
SELECT * FROM guilds WHERE id = '1184';
SELECT * FROM guild_config WHERE guild_id = '1184';
