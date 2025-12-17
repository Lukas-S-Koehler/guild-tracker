-- Complete Debug - Run this ALL AT ONCE
-- Make sure you're signed in to the app in another tab first!

-- Step 1: Are you authenticated?
SELECT '=== STEP 1: Authentication ===' as debug;
SELECT auth.uid() as current_user_id;

-- Step 2: Does guild_config exist?
SELECT '=== STEP 2: Guild Config ===' as debug;
SELECT guild_id, guild_name, api_key FROM guild_config WHERE guild_id = '554';

-- Step 3: Does guild_members exist?
SELECT '=== STEP 3: Guild Members ===' as debug;
SELECT id, guild_id, user_id, role FROM guild_members WHERE guild_id = '554';

-- Step 4: Do the user IDs match?
SELECT '=== STEP 4: ID Comparison ===' as debug;
SELECT
  auth.uid() as "auth_uid",
  (SELECT user_id FROM guild_members WHERE guild_id = '554') as "guild_member_user_id",
  (auth.uid() = (SELECT user_id FROM guild_members WHERE guild_id = '554')) as "do_they_match";

-- Step 5: Raw JOIN test (what the function does)
SELECT '=== STEP 5: Raw JOIN Test ===' as debug;
SELECT
  gm.guild_id,
  gc.guild_name,
  gm.role,
  gm.joined_at,
  gm.user_id as member_user_id,
  auth.uid() as current_auth_uid
FROM guild_members gm
JOIN guild_config gc ON gc.guild_id = gm.guild_id
WHERE gm.guild_id = '554';

-- Step 6: Function result
SELECT '=== STEP 6: Function Result ===' as debug;
SELECT * FROM get_user_guilds();
