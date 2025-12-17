-- Script to add yourself as a guild member
-- Replace the placeholders with your actual values

-- Step 1: Find your user ID
SELECT id, email FROM auth.users WHERE email = 'your@email.com';
-- Copy the 'id' value from the result

-- Step 2: Find the guild IDs you want to join
SELECT id, name, nickname, min_level FROM guilds ORDER BY display_order;
-- Note the 'id' values for the guilds you want

-- Step 3: Add yourself to a guild (replace the values in quotes)
-- Example for Dream Angels (check the actual id from step 2):
INSERT INTO guild_members (guild_id, user_id, role, joined_at)
VALUES ('1106', 'your-user-uuid-here', 'LEADER', NOW());

-- Add yourself to more guilds if needed:
-- INSERT INTO guild_members (guild_id, user_id, role, joined_at)
-- VALUES ('another-guild-id', 'your-user-uuid-here', 'OFFICER', NOW());

-- Step 4: Verify your memberships
SELECT
  gm.guild_id,
  g.nickname,
  g.name,
  gm.role,
  gm.joined_at
FROM guild_members gm
JOIN guilds g ON g.id = gm.guild_id
WHERE gm.user_id = 'your-user-uuid-here'
ORDER BY gm.joined_at;
