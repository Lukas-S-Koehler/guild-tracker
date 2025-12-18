-- ============================================
-- Debug guild_leaders table and relationships
-- Run this in your Supabase SQL Editor
-- ============================================

-- Check if guild_leaders table exists
SELECT
  table_name,
  table_schema
FROM information_schema.tables
WHERE table_name IN ('guild_leaders', 'guild_members', 'guilds');

-- Check all columns in guild_leaders
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'guild_leaders'
ORDER BY ordinal_position;

-- Check foreign key constraints on guild_leaders
SELECT
  tc.constraint_name,
  tc.table_name,
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
WHERE tc.table_name = 'guild_leaders'
  AND tc.constraint_type = 'FOREIGN KEY';

-- Check RLS policies on guild_leaders
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'guild_leaders';

-- Check if RLS is enabled
SELECT
  tablename,
  rowsecurity
FROM pg_tables
WHERE tablename IN ('guild_leaders', 'guilds');

-- Test query: Count records in guild_leaders
SELECT COUNT(*) as total_leaders FROM guild_leaders;

-- Test query: Check if guilds table has data
SELECT COUNT(*) as total_guilds FROM guilds;

-- Test query: Try the actual query that's failing (replace with your user_id)
-- SELECT
--   guild_id,
--   role,
--   joined_at
-- FROM guild_leaders
-- WHERE user_id = 'your-user-id-here';
