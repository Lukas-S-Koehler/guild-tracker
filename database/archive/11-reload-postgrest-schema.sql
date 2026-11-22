-- ============================================
-- RELOAD POSTGREST SCHEMA CACHE
-- ============================================
-- After changing foreign keys, PostgREST needs to reload
-- its schema to detect the new relationships
-- ============================================

-- This notifies PostgREST to reload its schema cache
NOTIFY pgrst, 'reload schema';

-- Give it a moment, then verify the foreign key is correct
DO $$
BEGIN
  RAISE NOTICE '===========================================';
  RAISE NOTICE 'POSTGREST SCHEMA RELOAD TRIGGERED';
  RAISE NOTICE '===========================================';
  RAISE NOTICE 'PostgREST will reload its schema cache';
  RAISE NOTICE 'This should fix the relationship detection';
  RAISE NOTICE '';
  RAISE NOTICE 'After running this:';
  RAISE NOTICE '  1. Wait 5-10 seconds';
  RAISE NOTICE '  2. Clear browser cache completely';
  RAISE NOTICE '  3. Try logging in again';
  RAISE NOTICE '===========================================';
END $$;

-- Verify the foreign key is pointing to the correct table
SELECT
  'Current Foreign Key:' as info,
  tc.table_name,
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_name = 'guild_members'
  AND kcu.column_name = 'guild_id';

-- Verify RLS policies are in place
SELECT
  'RLS Policies Status:' as info,
  tablename,
  COUNT(*) as policy_count
FROM pg_policies
WHERE tablename IN ('guild_members', 'guilds')
GROUP BY tablename;
