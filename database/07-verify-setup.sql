-- ============================================
-- VERIFICATION SCRIPT
-- ============================================
-- Run this after running 06-comprehensive-fix-loading-issues.sql
-- to verify everything is set up correctly
-- ============================================

-- ============================================
-- 1. Check Table Existence
-- ============================================
SELECT
  '✅ TABLE CHECK' as section,
  EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'guilds') as has_guilds,
  EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'guild_config') as has_guild_config,
  EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'guild_members') as has_guild_members,
  EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'member_keys') as has_member_keys,
  EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'members') as has_members,
  EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'daily_logs') as has_daily_logs,
  EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'challenges') as has_challenges;

-- ============================================
-- 2. Check Guild Data
-- ============================================
SELECT
  '✅ GUILD DATA' as section,
  COUNT(*) as total_guilds,
  COUNT(CASE WHEN g.id IS NOT NULL AND gc.guild_id IS NOT NULL THEN 1 END) as guilds_with_config,
  COUNT(CASE WHEN gc.guild_id IS NULL THEN 1 END) as guilds_missing_config
FROM guilds g
LEFT JOIN guild_config gc ON g.id = gc.guild_id;

-- List all guilds with their config status
SELECT
  '📋 GUILD LIST' as section,
  g.id,
  g.name,
  g.nickname,
  CASE
    WHEN gc.guild_id IS NOT NULL THEN '✅ Has Config'
    ELSE '❌ Missing Config'
  END as config_status
FROM guilds g
LEFT JOIN guild_config gc ON g.id = gc.guild_id
ORDER BY g.display_order;

-- ============================================
-- 3. Check Guild Memberships
-- ============================================
SELECT
  '✅ MEMBERSHIP DATA' as section,
  COUNT(*) as total_memberships,
  COUNT(DISTINCT user_id) as unique_users,
  COUNT(DISTINCT guild_id) as guilds_with_members
FROM guild_members;

-- ============================================
-- 4. Check RLS Policies
-- ============================================
SELECT
  '✅ RLS POLICIES - guild_members' as section,
  COUNT(*) as policy_count,
  STRING_AGG(policyname, ', ') as policies
FROM pg_policies
WHERE tablename = 'guild_members';

SELECT
  '✅ RLS POLICIES - guilds' as section,
  COUNT(*) as policy_count,
  STRING_AGG(policyname, ', ') as policies
FROM pg_policies
WHERE tablename = 'guilds';

SELECT
  '✅ RLS POLICIES - guild_config' as section,
  COUNT(*) as policy_count,
  STRING_AGG(policyname, ', ') as policies
FROM pg_policies
WHERE tablename = 'guild_config';

SELECT
  '✅ RLS POLICIES - member_keys' as section,
  COUNT(*) as policy_count,
  STRING_AGG(policyname, ', ') as policies
FROM pg_policies
WHERE tablename = 'member_keys';

-- ============================================
-- 5. Check Indexes
-- ============================================
SELECT
  '✅ INDEXES - guild_members' as section,
  COUNT(*) as index_count,
  STRING_AGG(indexname, ', ') as indexes
FROM pg_indexes
WHERE tablename = 'guild_members';

SELECT
  '✅ INDEXES - guilds' as section,
  COUNT(*) as index_count,
  STRING_AGG(indexname, ', ') as indexes
FROM pg_indexes
WHERE tablename = 'guilds';

-- ============================================
-- 6. Check Foreign Keys
-- ============================================
SELECT
  '✅ FOREIGN KEYS' as section,
  tc.table_name,
  tc.constraint_name,
  tc.constraint_type,
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
  AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_name IN ('guild_members', 'guild_config', 'member_keys')
ORDER BY tc.table_name, tc.constraint_name;

-- ============================================
-- 7. Expected Results Summary
-- ============================================
DO $$
DECLARE
  guilds_count INTEGER;
  configs_count INTEGER;
  members_count INTEGER;
  gm_policies_count INTEGER;
  guilds_policies_count INTEGER;
  gm_indexes_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO guilds_count FROM guilds;
  SELECT COUNT(*) INTO configs_count FROM guild_config;
  SELECT COUNT(*) INTO members_count FROM guild_members;
  SELECT COUNT(*) INTO gm_policies_count FROM pg_policies WHERE tablename = 'guild_members';
  SELECT COUNT(*) INTO guilds_policies_count FROM pg_policies WHERE tablename = 'guilds';
  SELECT COUNT(*) INTO gm_indexes_count FROM pg_indexes WHERE tablename = 'guild_members';

  RAISE NOTICE '===========================================';
  RAISE NOTICE 'VERIFICATION SUMMARY';
  RAISE NOTICE '===========================================';
  RAISE NOTICE 'Guilds: % (should be 11)', guilds_count;
  RAISE NOTICE 'Guild Configs: % (should match guilds count)', configs_count;
  RAISE NOTICE 'Guild Members: %', members_count;
  RAISE NOTICE 'RLS Policies on guild_members: % (should be 3)', gm_policies_count;
  RAISE NOTICE 'RLS Policies on guilds: % (should be 1)', guilds_policies_count;
  RAISE NOTICE 'Indexes on guild_members: % (should be at least 5)', gm_indexes_count;
  RAISE NOTICE '===========================================';

  IF guilds_count = 0 THEN
    RAISE WARNING '❌ No guilds found! Run 01-insert-all-guilds.sql';
  ELSIF configs_count < guilds_count THEN
    RAISE WARNING '❌ Some guilds missing config! Run 02-create-guild-configs-from-existing.sql';
  ELSIF members_count = 0 THEN
    RAISE WARNING '⚠️  No guild members yet. Add yourself using 03-add-yourself-as-member.sql';
  ELSIF gm_policies_count < 3 THEN
    RAISE WARNING '❌ Missing RLS policies on guild_members! Run 06-comprehensive-fix-loading-issues.sql';
  ELSIF guilds_policies_count < 1 THEN
    RAISE WARNING '❌ Missing RLS policies on guilds! Run 06-comprehensive-fix-loading-issues.sql';
  ELSIF gm_indexes_count < 5 THEN
    RAISE WARNING '⚠️  Missing indexes on guild_members! Run 06-comprehensive-fix-loading-issues.sql';
  ELSE
    RAISE NOTICE '✅ Everything looks good!';
    RAISE NOTICE '✅ Your database is properly configured';
    RAISE NOTICE '✅ You should not see loading screens or "no guilds found"';
  END IF;

  RAISE NOTICE '===========================================';
END $$;
