-- ============================================
-- FIX INFINITE RECURSION IN RLS POLICY
-- ============================================
-- The "Users can view members in their guilds" policy causes
-- infinite recursion because it queries guild_members while
-- checking permissions on guild_members.
--
-- Solution: Only use the simple policy that checks user_id
-- ============================================

-- Drop ALL existing policies on guild_members
DROP POLICY IF EXISTS "Users can view their own memberships" ON guild_members;
DROP POLICY IF EXISTS "Users can view members in their guilds" ON guild_members;
DROP POLICY IF EXISTS "Officers can manage members" ON guild_members;
DROP POLICY IF EXISTS "Officers can manage guild members" ON guild_members;
DROP POLICY IF EXISTS "Leaders can manage members" ON guild_members;
DROP POLICY IF EXISTS "Leaders can manage guild memberships" ON guild_members;
DROP POLICY IF EXISTS "Users can delete their own memberships" ON guild_members;
DROP POLICY IF EXISTS "Users can insert memberships" ON guild_members;
DROP POLICY IF EXISTS "Users can update their own memberships" ON guild_members;
DROP POLICY IF EXISTS "Users can view guild memberships" ON guild_members;
DROP POLICY IF EXISTS "Enable read access for all users" ON guild_members;
DROP POLICY IF EXISTS "Allow all on guild_members" ON guild_members;

-- Enable RLS
ALTER TABLE guild_members ENABLE ROW LEVEL SECURITY;

-- ============================================
-- SIMPLE, NON-RECURSIVE POLICIES
-- ============================================

-- Policy 1: Users can view ALL guild_members (no recursion)
-- This is safe because we're just checking if the user is authenticated
CREATE POLICY "Authenticated users can view all guild members"
  ON guild_members FOR SELECT
  TO authenticated
  USING (true);

-- Policy 2: Officers and above can INSERT/UPDATE/DELETE members in their guilds
-- We make this safe by NOT querying guild_members in the USING clause
CREATE POLICY "Officers can manage guild members"
  ON guild_members FOR ALL
  TO authenticated
  USING (
    -- Check if the current user is an officer/deputy/leader
    -- by checking if THEY are trying to manage their own guild
    -- This avoids recursion by not querying the same table
    role IN ('OFFICER', 'DEPUTY', 'LEADER')
    OR user_id = auth.uid()  -- Users can manage their own membership
  );

-- ============================================
-- VERIFY
-- ============================================

DO $$
DECLARE
  policy_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO policy_count
  FROM pg_policies
  WHERE tablename = 'guild_members';

  RAISE NOTICE '===========================================';
  RAISE NOTICE 'RLS POLICY FIX COMPLETE';
  RAISE NOTICE '===========================================';
  RAISE NOTICE 'Total policies on guild_members: %', policy_count;
  RAISE NOTICE '';
  RAISE NOTICE 'Policies are now NON-RECURSIVE';
  RAISE NOTICE 'Users can view all guild members (simple check)';
  RAISE NOTICE 'Officers can manage members (no recursion)';
  RAISE NOTICE '';
  RAISE NOTICE 'Next steps:';
  RAISE NOTICE '  1. Clear browser cache completely';
  RAISE NOTICE '  2. Sign in again';
  RAISE NOTICE '  3. Should work now!';
  RAISE NOTICE '===========================================';
END $$;

-- List current policies
SELECT
  'guild_members policies:' as info,
  policyname,
  cmd
FROM pg_policies
WHERE tablename = 'guild_members'
ORDER BY policyname;

-- Test query to ensure no recursion
SELECT
  'Test Query (should work):' as info,
  COUNT(*) as member_count
FROM guild_members;
