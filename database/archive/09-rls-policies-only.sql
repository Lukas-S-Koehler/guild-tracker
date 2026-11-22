-- ============================================
-- FIX RLS POLICIES ONLY (No Foreign Keys or Indexes)
-- ============================================
-- Run this if script 06 failed due to already existing constraints
-- This ONLY fixes the RLS policies
-- ============================================

-- ============================================
-- 1. Fix RLS Policies on guild_members
-- ============================================

-- Drop ALL existing policies
DROP POLICY IF EXISTS "Users can view their own memberships" ON guild_members;
DROP POLICY IF EXISTS "Users can view members in their guilds" ON guild_members;
DROP POLICY IF EXISTS "Officers can manage members" ON guild_members;
DROP POLICY IF EXISTS "Officers can manage guild members" ON guild_members;
DROP POLICY IF EXISTS "Leaders can manage members" ON guild_members;
DROP POLICY IF EXISTS "Enable read access for all users" ON guild_members;
DROP POLICY IF EXISTS "Allow all on guild_members" ON guild_members;

-- Enable RLS
ALTER TABLE guild_members ENABLE ROW LEVEL SECURITY;

-- CRITICAL Policy 1: Users can view their own guild memberships
CREATE POLICY "Users can view their own memberships"
  ON guild_members FOR SELECT
  USING (user_id = auth.uid());

-- Policy 2: Users can view other members in guilds they belong to
CREATE POLICY "Users can view members in their guilds"
  ON guild_members FOR SELECT
  USING (
    guild_id IN (
      SELECT guild_id FROM guild_members WHERE user_id = auth.uid()
    )
  );

-- Policy 3: Officers and above can manage members in their guilds
CREATE POLICY "Officers can manage guild members"
  ON guild_members FOR ALL
  USING (
    guild_id IN (
      SELECT guild_id FROM guild_members
      WHERE user_id = auth.uid()
      AND role IN ('OFFICER', 'DEPUTY', 'LEADER')
    )
  );

-- ============================================
-- 2. Fix RLS Policies on guilds table
-- ============================================

-- Drop existing policies
DROP POLICY IF EXISTS "Guilds are public" ON guilds;
DROP POLICY IF EXISTS "Enable read access for all users" ON guilds;
DROP POLICY IF EXISTS "Allow all on guilds" ON guilds;

-- Enable RLS
ALTER TABLE guilds ENABLE ROW LEVEL SECURITY;

-- Make guilds publicly readable (needed for JOINs in AuthContext)
CREATE POLICY "Guilds are public"
  ON guilds FOR SELECT
  USING (true);

-- ============================================
-- 3. Grant Permissions
-- ============================================

GRANT SELECT, INSERT, UPDATE, DELETE ON guild_members TO authenticated;
GRANT SELECT ON guilds TO authenticated;
GRANT USAGE ON SCHEMA public TO authenticated;

-- ============================================
-- 4. Verify
-- ============================================

DO $$
DECLARE
  gm_policies INTEGER;
  guilds_policies INTEGER;
BEGIN
  SELECT COUNT(*) INTO gm_policies FROM pg_policies WHERE tablename = 'guild_members';
  SELECT COUNT(*) INTO guilds_policies FROM pg_policies WHERE tablename = 'guilds';

  RAISE NOTICE '===========================================';
  RAISE NOTICE 'RLS POLICIES CREATED';
  RAISE NOTICE '===========================================';
  RAISE NOTICE 'guild_members policies: % (should be 3)', gm_policies;
  RAISE NOTICE 'guilds policies: % (should be 1)', guilds_policies;

  IF gm_policies >= 3 AND guilds_policies >= 1 THEN
    RAISE NOTICE '✅ RLS policies are correct!';
    RAISE NOTICE '✅ Clear browser cache and try logging in again';
  ELSE
    RAISE WARNING '❌ Some policies are missing!';
  END IF;

  RAISE NOTICE '===========================================';
END $$;

-- List the policies for verification
SELECT 'guild_members policies:' as info, policyname
FROM pg_policies
WHERE tablename = 'guild_members'
UNION ALL
SELECT 'guilds policies:', policyname
FROM pg_policies
WHERE tablename = 'guilds';
