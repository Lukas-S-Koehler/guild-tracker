-- ============================================
-- DEBUG: Find Why "No Guilds Found" Error Occurs
-- ============================================
-- This script tests EXACTLY what the app is doing
-- ============================================

-- Replace this with YOUR user ID
-- From your data: cc2a80d5-8e11-40b4-8e84-be4a6bc1c397
DO $$
DECLARE
  test_user_id UUID := 'cc2a80d5-8e11-40b4-8e84-be4a6bc1c397'::uuid;
BEGIN
  RAISE NOTICE '===========================================';
  RAISE NOTICE 'DEBUGGING GUILD QUERY';
  RAISE NOTICE 'Testing for user: %', test_user_id;
  RAISE NOTICE '===========================================';
END $$;

-- ============================================
-- Step 1: Check if guild 554 exists
-- ============================================
SELECT
  '1️⃣ Guild 554 exists?' as check_step,
  CASE
    WHEN EXISTS (SELECT 1 FROM guilds WHERE id = '554') THEN '✅ YES'
    ELSE '❌ NO - Guild 554 is missing!'
  END as result;

SELECT
  '   Guild 554 details:' as info,
  id, name, nickname, min_level
FROM guilds
WHERE id = '554';

-- ============================================
-- Step 2: Check if user membership exists
-- ============================================
SELECT
  '2️⃣ User membership exists?' as check_step,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM guild_members
      WHERE user_id = 'cc2a80d5-8e11-40b4-8e84-be4a6bc1c397'::uuid
    ) THEN '✅ YES'
    ELSE '❌ NO - No membership found!'
  END as result;

SELECT
  '   Membership details:' as info,
  id, guild_id, user_id, role, joined_at
FROM guild_members
WHERE user_id = 'cc2a80d5-8e11-40b4-8e84-be4a6bc1c397'::uuid;

-- ============================================
-- Step 3: Test the EXACT query AuthContext runs
-- ============================================
-- This is the query from AuthContext.tsx lines 88-99
SELECT
  '3️⃣ AuthContext query test:' as check_step,
  'Testing the exact query the app runs...' as info;

SELECT
  gm.guild_id,
  gm.role,
  gm.joined_at,
  g.name as guild_name
FROM guild_members gm
INNER JOIN guilds g ON g.id = gm.guild_id
WHERE gm.user_id = 'cc2a80d5-8e11-40b4-8e84-be4a6bc1c397'::uuid
ORDER BY gm.joined_at ASC;

-- ============================================
-- Step 4: Check RLS allows the query
-- ============================================
-- Simulate being authenticated as this user
SET LOCAL role TO authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"cc2a80d5-8e11-40b4-8e84-be4a6bc1c397"}';

SELECT
  '4️⃣ RLS test (simulating auth):' as check_step,
  'Running query AS the authenticated user...' as info;

-- This should work if RLS is correct
SELECT
  gm.guild_id,
  gm.role,
  gm.joined_at,
  g.name
FROM guild_members gm
INNER JOIN guilds g ON g.id = gm.guild_id
WHERE gm.user_id = 'cc2a80d5-8e11-40b4-8e84-be4a6bc1c397'::uuid;

RESET role;

-- ============================================
-- Step 5: Check if guild_config exists for 554
-- ============================================
SELECT
  '5️⃣ Guild config exists for 554?' as check_step,
  CASE
    WHEN EXISTS (SELECT 1 FROM guild_config WHERE guild_id = '554') THEN '✅ YES'
    ELSE '⚠️  NO - But this should not block memberships anymore'
  END as result;

SELECT
  '   Config details:' as info,
  id, guild_id, guild_name, donation_requirement
FROM guild_config
WHERE guild_id = '554';

-- ============================================
-- Step 6: List ALL policies to verify they're correct
-- ============================================
SELECT
  '6️⃣ RLS Policies on guild_members:' as check_step,
  policyname,
  cmd,
  CASE
    WHEN qual LIKE '%auth.uid()%' THEN '✅ Uses auth.uid()'
    WHEN qual = 'true' THEN '✅ Always true'
    ELSE qual
  END as policy_check
FROM pg_policies
WHERE tablename = 'guild_members'
ORDER BY policyname;

SELECT
  '6️⃣ RLS Policies on guilds:' as check_step,
  policyname,
  cmd,
  qual as policy_check
FROM pg_policies
WHERE tablename = 'guilds';

-- ============================================
-- Step 7: Check if there's an issue with auth.uid()
-- ============================================
SELECT
  '7️⃣ Auth function test:' as check_step,
  'auth.uid() returns: ' || COALESCE(auth.uid()::text, 'NULL') as result;

-- ============================================
-- SUMMARY
-- ============================================
DO $$
DECLARE
  guild_exists BOOLEAN;
  member_exists BOOLEAN;
  query_works BOOLEAN;
  policies_count INTEGER;
BEGIN
  -- Check if guild exists
  SELECT EXISTS (SELECT 1 FROM guilds WHERE id = '554') INTO guild_exists;

  -- Check if membership exists
  SELECT EXISTS (
    SELECT 1 FROM guild_members
    WHERE user_id = 'cc2a80d5-8e11-40b4-8e84-be4a6bc1c397'::uuid
  ) INTO member_exists;

  -- Check if query returns results
  SELECT EXISTS (
    SELECT 1 FROM guild_members gm
    INNER JOIN guilds g ON g.id = gm.guild_id
    WHERE gm.user_id = 'cc2a80d5-8e11-40b4-8e84-be4a6bc1c397'::uuid
  ) INTO query_works;

  -- Count policies
  SELECT COUNT(*) INTO policies_count
  FROM pg_policies
  WHERE tablename = 'guild_members'
  AND policyname IN (
    'Users can view their own memberships',
    'Users can view members in their guilds'
  );

  RAISE NOTICE '===========================================';
  RAISE NOTICE 'DIAGNOSIS SUMMARY';
  RAISE NOTICE '===========================================';
  RAISE NOTICE 'Guild 554 exists: %', guild_exists;
  RAISE NOTICE 'User membership exists: %', member_exists;
  RAISE NOTICE 'JOIN query works: %', query_works;
  RAISE NOTICE 'Critical RLS policies exist: % of 2', policies_count;
  RAISE NOTICE '===========================================';

  IF NOT guild_exists THEN
    RAISE WARNING '❌ PROBLEM: Guild 554 does not exist in guilds table!';
    RAISE NOTICE 'SOLUTION: Run 01-insert-all-guilds.sql to create all guilds';
  ELSIF NOT member_exists THEN
    RAISE WARNING '❌ PROBLEM: User membership does not exist!';
    RAISE NOTICE 'SOLUTION: Run 03-add-yourself-as-member.sql';
  ELSIF NOT query_works THEN
    RAISE WARNING '❌ PROBLEM: The JOIN query fails!';
    RAISE NOTICE 'Possible causes:';
    RAISE NOTICE '  - Guild 554 missing from guilds table';
    RAISE NOTICE '  - RLS blocking the JOIN';
    RAISE NOTICE '  - Foreign key issue';
  ELSIF policies_count < 2 THEN
    RAISE WARNING '❌ PROBLEM: Missing critical RLS policies!';
    RAISE NOTICE 'SOLUTION: Run 09-rls-policies-only.sql';
  ELSE
    RAISE NOTICE '✅ Database looks correct!';
    RAISE NOTICE '';
    RAISE NOTICE 'If the app still shows "No Guilds Found", the issue is:';
    RAISE NOTICE '  1. Browser cache not cleared properly';
    RAISE NOTICE '  2. Supabase client configuration issue';
    RAISE NOTICE '  3. Check browser console for JavaScript errors';
    RAISE NOTICE '';
    RAISE NOTICE 'Next steps:';
    RAISE NOTICE '  - Open browser DevTools (F12)';
    RAISE NOTICE '  - Go to Application/Storage tab';
    RAISE NOTICE '  - Clear ALL site data';
    RAISE NOTICE '  - Check Network tab for failed requests';
  END IF;

  RAISE NOTICE '===========================================';
END $$;
