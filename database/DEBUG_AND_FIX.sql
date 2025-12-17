-- DEBUG AND FIX: Step-by-step troubleshooting
-- Run this in Supabase SQL Editor while you're signed in to the app

-- ====================================
-- STEP 1: Check if you're authenticated
-- ====================================
SELECT 'Step 1: Current User' as step, auth.uid() as user_id;
-- Expected: Should show your user_id (cc2a80d5-8e11-40b4-8e84-be4a6bc1c397)
-- If it shows NULL, you're not signed in to Supabase (sign in to the app first, keep that tab open)

-- ====================================
-- STEP 2: Check guild_config
-- ====================================
SELECT 'Step 2: Guild Config' as step;
SELECT * FROM guild_config WHERE guild_id = '554';
-- Expected: Should return 1 row with guild_id='554'

-- ====================================
-- STEP 3: Check guild_members
-- ====================================
SELECT 'Step 3: Guild Membership' as step;
SELECT * FROM guild_members WHERE guild_id = '554';
-- Expected: Should return 1 row with user_id matching your auth.uid()

-- ====================================
-- STEP 4: Test if the IDs match
-- ====================================
SELECT 'Step 4: ID Matching' as step;
SELECT
  auth.uid() as "Your Current User ID",
  (SELECT user_id FROM guild_members WHERE guild_id = '554') as "Guild Member User ID",
  CASE
    WHEN auth.uid() = (SELECT user_id FROM guild_members WHERE guild_id = '554')
    THEN '✅ MATCH - IDs are the same'
    ELSE '❌ MISMATCH - This is the problem!'
  END as status;

-- ====================================
-- STEP 5: Create/Update the function
-- ====================================
CREATE OR REPLACE FUNCTION get_user_guilds()
RETURNS TABLE (
  guild_id TEXT,
  guild_name TEXT,
  role TEXT,
  joined_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    gm.guild_id,
    gc.guild_name,
    gm.role,
    gm.joined_at
  FROM guild_members gm
  JOIN guild_config gc ON gc.guild_id = gm.guild_id
  WHERE gm.user_id = auth.uid()
  ORDER BY gm.joined_at ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ====================================
-- STEP 6: Test the function
-- ====================================
SELECT 'Step 6: Function Test' as step;
SELECT * FROM get_user_guilds();
-- Expected: Should return 1 row with your guild

-- ====================================
-- STEP 7: If Step 4 showed MISMATCH, run this fix:
-- ====================================
-- UNCOMMENT THE NEXT LINE IF IDs DON'T MATCH:
-- UPDATE guild_members SET user_id = auth.uid() WHERE guild_id = '554';

-- Then re-run Step 6 to test again
