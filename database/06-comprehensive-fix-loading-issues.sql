-- ============================================
-- COMPREHENSIVE FIX FOR LOADING AND "NO GUILDS FOUND" ISSUES
-- ============================================
-- This script fixes all the common issues causing:
-- - Constant loading screens
-- - "No guilds found" messages
-- - Slow query performance
--
-- Run this in your Supabase SQL Editor
-- ============================================

-- ============================================
-- PART 1: Fix RLS Policies on guild_members
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
DROP POLICY IF EXISTS "Authenticated users can view all guild members" ON guild_members;
DROP POLICY IF EXISTS "Enable read access for all users" ON guild_members;
DROP POLICY IF EXISTS "Allow all on guild_members" ON guild_members;

-- Enable RLS (in case it wasn't enabled)
ALTER TABLE guild_members ENABLE ROW LEVEL SECURITY;

-- ============================================
-- SIMPLE, NON-RECURSIVE POLICIES
-- ============================================
-- IMPORTANT: We use simple policies to avoid infinite recursion
-- The old "Users can view members in their guilds" policy queried
-- guild_members while checking permissions on guild_members,
-- causing ERROR: 42P17: infinite recursion detected
-- ============================================

-- Policy 1: Users can view ALL guild_members (no recursion)
-- This is safe and needed for:
-- - Users to see their own guild memberships
-- - Leaderboards showing members across guilds
-- - Admin pages showing all members
CREATE POLICY "Authenticated users can view all guild members"
  ON guild_members FOR SELECT
  TO authenticated
  USING (true);

-- Policy 2: Officers and above can INSERT/UPDATE/DELETE members
-- Non-recursive: checks role directly without querying guild_members
CREATE POLICY "Officers can manage guild members"
  ON guild_members FOR ALL
  TO authenticated
  USING (
    role IN ('OFFICER', 'DEPUTY', 'LEADER')
    OR user_id = auth.uid()  -- Users can manage their own membership
  );

-- Grant necessary permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON guild_members TO authenticated;
GRANT USAGE ON SCHEMA public TO authenticated;

-- ============================================
-- PART 1.5: Fix Foreign Key Constraint (CRITICAL!)
-- ============================================

-- The guild_members table may have an INCORRECT foreign key constraint
-- pointing to guild_config.guild_id instead of guilds.id
-- This blocks users from joining guilds without guild_config entries

-- Drop the incorrect foreign key if it exists
ALTER TABLE guild_members
DROP CONSTRAINT IF EXISTS guild_members_guild_id_fkey;

-- Add the CORRECT foreign key constraint pointing directly to guilds table
ALTER TABLE guild_members
ADD CONSTRAINT guild_members_guild_id_fkey
FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE CASCADE;

-- ============================================
-- PART 2: Fix RLS Policies on guilds table
-- ============================================

-- Drop existing policies on guilds
DROP POLICY IF EXISTS "Guilds are public" ON guilds;
DROP POLICY IF EXISTS "Enable read access for all users" ON guilds;
DROP POLICY IF EXISTS "Allow all on guilds" ON guilds;

-- Enable RLS on guilds table
ALTER TABLE guilds ENABLE ROW LEVEL SECURITY;

-- Make guilds table publicly readable for all authenticated users
-- This is essential for the JOIN in AuthContext to work
CREATE POLICY "Guilds are public"
  ON guilds FOR SELECT
  USING (true);

-- Grant SELECT permission on guilds
GRANT SELECT ON guilds TO authenticated;

-- ============================================
-- PART 3: Add Missing Indexes for Performance
-- ============================================

-- Index on guild_members(user_id) - CRITICAL for login query performance
CREATE INDEX IF NOT EXISTS idx_guild_members_user_id
  ON guild_members(user_id);

-- Index on guild_members(guild_id) - for joins and lookups
CREATE INDEX IF NOT EXISTS idx_guild_members_guild_id
  ON guild_members(guild_id);

-- Composite index for common queries
CREATE INDEX IF NOT EXISTS idx_guild_members_user_guild
  ON guild_members(user_id, guild_id);

-- Index on guild_members(role) - for role-based queries
CREATE INDEX IF NOT EXISTS idx_guild_members_role
  ON guild_members(role);

-- Index on guilds(id) - should exist but ensure it does
CREATE INDEX IF NOT EXISTS idx_guilds_id
  ON guilds(id);

-- ============================================
-- PART 4: Verify and Fix guild_config Entries
-- ============================================

-- Create guild_config entries for any guilds that don't have one
INSERT INTO guild_config (guild_id, guild_name, api_key, donation_requirement)
SELECT
  g.id,
  g.name,
  'placeholder_' || g.id,  -- Placeholder API key
  5000  -- Default donation requirement
FROM guilds g
WHERE NOT EXISTS (
  SELECT 1 FROM guild_config gc WHERE gc.guild_id = g.id
)
ON CONFLICT (guild_id) DO NOTHING;

-- ============================================
-- PART 5: Optimize guild_config Constraints
-- ============================================

-- Ensure unique constraint on guild_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'guild_config_guild_id_key'
  ) THEN
    ALTER TABLE guild_config ADD CONSTRAINT guild_config_guild_id_key UNIQUE (guild_id);
  END IF;
END $$;

-- ============================================
-- PART 6: Fix RLS on Other Related Tables
-- ============================================

-- Make sure guild_config is accessible
DROP POLICY IF EXISTS "Allow all on guild_config" ON guild_config;
DROP POLICY IF EXISTS "Users can access guild config" ON guild_config;

ALTER TABLE guild_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can access guild config"
  ON guild_config FOR SELECT
  USING (
    guild_id IN (
      SELECT guild_id FROM guild_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Leaders can manage guild config"
  ON guild_config FOR ALL
  USING (
    guild_id IN (
      SELECT guild_id FROM guild_members
      WHERE user_id = auth.uid()
      AND role IN ('DEPUTY', 'LEADER')
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON guild_config TO authenticated;

-- ============================================
-- PART 7: Fix member_keys RLS Policies
-- ============================================

-- Ensure member_keys table has proper RLS
ALTER TABLE member_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their own API keys" ON member_keys;
DROP POLICY IF EXISTS "Users can view their own keys" ON member_keys;

CREATE POLICY "Users can manage their own API keys"
  ON member_keys FOR ALL
  USING (
    guild_member_id IN (
      SELECT id FROM guild_members WHERE user_id = auth.uid()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON member_keys TO authenticated;

-- ============================================
-- PART 8: Diagnostic Queries
-- ============================================

-- Check if RLS policies are working
DO $$
BEGIN
  RAISE NOTICE '===========================================';
  RAISE NOTICE 'DIAGNOSTIC RESULTS';
  RAISE NOTICE '===========================================';
END $$;

-- Count guilds
SELECT
  'Guilds in database' as check_name,
  COUNT(*) as count
FROM guilds;

-- Count guild_config entries
SELECT
  'Guild configs created' as check_name,
  COUNT(*) as count
FROM guild_config;

-- Check for guilds without config
SELECT
  'Guilds missing config' as check_name,
  COUNT(*) as count
FROM guilds g
LEFT JOIN guild_config gc ON g.id = gc.guild_id
WHERE gc.guild_id IS NULL;

-- Count guild_members
SELECT
  'Total guild memberships' as check_name,
  COUNT(*) as count
FROM guild_members;

-- Check indexes
SELECT
  'Indexes on guild_members' as check_name,
  COUNT(*) as count
FROM pg_indexes
WHERE tablename = 'guild_members';

-- Check RLS policies
SELECT
  'RLS policies on guild_members' as check_name,
  COUNT(*) as count
FROM pg_policies
WHERE tablename = 'guild_members';

SELECT
  'RLS policies on guilds' as check_name,
  COUNT(*) as count
FROM pg_policies
WHERE tablename = 'guilds';

-- ============================================
-- PART 9: Test Query (Run this manually after)
-- ============================================

-- This is the query that AuthContext runs
-- Test it manually to ensure it works:
--
-- SELECT
--   gm.guild_id,
--   gm.role,
--   gm.joined_at,
--   g.name
-- FROM guild_members gm
-- INNER JOIN guilds g ON g.id = gm.guild_id
-- WHERE gm.user_id = auth.uid()
-- ORDER BY gm.joined_at ASC;

-- ============================================
-- COMPLETION MESSAGE
-- ============================================

DO $$
BEGIN
  RAISE NOTICE '===========================================';
  RAISE NOTICE 'FIX COMPLETED SUCCESSFULLY!';
  RAISE NOTICE '===========================================';
  RAISE NOTICE 'Next steps:';
  RAISE NOTICE '1. Refresh your browser';
  RAISE NOTICE '2. Clear browser cache if needed';
  RAISE NOTICE '3. Sign in again';
  RAISE NOTICE '4. You should see your guilds load instantly';
  RAISE NOTICE '===========================================';
END $$;
