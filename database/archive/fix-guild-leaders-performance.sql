-- ============================================
-- Fix guild_leaders table performance issues
-- Run this in your Supabase SQL Editor
-- ============================================

-- Step 1: Add indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_guild_leaders_user_id
ON guild_leaders(user_id);

CREATE INDEX IF NOT EXISTS idx_guild_leaders_guild_id
ON guild_leaders(guild_id);

CREATE INDEX IF NOT EXISTS idx_guild_leaders_user_guild
ON guild_leaders(user_id, guild_id);

-- Step 2: Ensure foreign key constraint exists
ALTER TABLE guild_leaders
DROP CONSTRAINT IF EXISTS guild_leaders_guild_id_fkey;

ALTER TABLE guild_leaders
ADD CONSTRAINT guild_leaders_guild_id_fkey
FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE CASCADE;

-- Step 3: Drop ALL RLS policies and recreate simple ones
DROP POLICY IF EXISTS "Allow authenticated users to view guild members" ON guild_leaders;
DROP POLICY IF EXISTS "Authenticated users can view all guild members" ON guild_leaders;
DROP POLICY IF EXISTS "Authenticated users can view all guild leaders" ON guild_leaders;
DROP POLICY IF EXISTS "Enable read access for all users" ON guild_leaders;
DROP POLICY IF EXISTS "Officers can manage guild members" ON guild_leaders;
DROP POLICY IF EXISTS "allow_authenticated_read" ON guild_leaders;

-- Create simple, non-recursive RLS policy
CREATE POLICY "allow_authenticated_read"
ON guild_leaders FOR SELECT
TO authenticated
USING (true);

-- Ensure RLS is enabled
ALTER TABLE guild_leaders ENABLE ROW LEVEL SECURITY;

-- Step 4: Verify the setup
SELECT 'Indexes created successfully' as status;

-- Check indexes
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'guild_leaders';

-- Check RLS policies
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual
FROM pg_policies
WHERE tablename = 'guild_leaders';

-- Test query (replace with actual user_id)
-- SELECT guild_id, role, joined_at
-- FROM guild_leaders
-- WHERE user_id = 'your-user-id-here';

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';
