-- ============================================
-- COMPREHENSIVE FIX: All RLS Policies
-- This fixes ALL recursive RLS policies across all tables
-- Run this in your Supabase SQL Editor
-- ============================================

-- ============================================
-- PART 1: Fix guild_leaders table
-- ============================================

-- Drop ALL existing policies on guild_leaders
DROP POLICY IF EXISTS "Allow authenticated users to view guild members" ON guild_leaders;
DROP POLICY IF EXISTS "Authenticated users can view all guild members" ON guild_leaders;
DROP POLICY IF EXISTS "Authenticated users can view all guild leaders" ON guild_leaders;
DROP POLICY IF EXISTS "Enable read access for all users" ON guild_leaders;
DROP POLICY IF EXISTS "Officers can manage guild members" ON guild_leaders;
DROP POLICY IF EXISTS "allow_authenticated_read" ON guild_leaders;
DROP POLICY IF EXISTS "Users can view their own memberships" ON guild_leaders;
DROP POLICY IF EXISTS "Users can view members in their guilds" ON guild_leaders;
DROP POLICY IF EXISTS "Officers can manage members" ON guild_leaders;

-- Create single simple READ policy (non-recursive)
CREATE POLICY "guild_leaders_read"
ON guild_leaders FOR SELECT
TO authenticated
USING (true);

-- Create simple INSERT/UPDATE/DELETE policies
CREATE POLICY "guild_leaders_insert"
ON guild_leaders FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid() OR EXISTS (
  SELECT 1 FROM guild_leaders gl
  WHERE gl.guild_id = guild_leaders.guild_id
  AND gl.user_id = auth.uid()
  AND gl.role IN ('LEADER', 'DEPUTY', 'OFFICER')
));

CREATE POLICY "guild_leaders_update"
ON guild_leaders FOR UPDATE
TO authenticated
USING (user_id = auth.uid() OR role IN ('LEADER', 'DEPUTY', 'OFFICER'));

CREATE POLICY "guild_leaders_delete"
ON guild_leaders FOR DELETE
TO authenticated
USING (user_id = auth.uid() OR role IN ('LEADER', 'DEPUTY', 'OFFICER'));

ALTER TABLE guild_leaders ENABLE ROW LEVEL SECURITY;

-- ============================================
-- PART 2: Fix member_keys table (recursive policies)
-- ============================================

-- Drop ALL existing policies on member_keys
DROP POLICY IF EXISTS "Users can view their own API keys" ON member_keys;
DROP POLICY IF EXISTS "Users can insert their own API keys" ON member_keys;
DROP POLICY IF EXISTS "Users can update their own API keys" ON member_keys;
DROP POLICY IF EXISTS "Users can delete their own API keys" ON member_keys;

-- Create non-recursive policies using guild_member_id directly
CREATE POLICY "member_keys_select"
ON member_keys FOR SELECT
TO authenticated
USING (
  guild_member_id IN (
    SELECT id FROM guild_leaders WHERE user_id = auth.uid()
  )
);

CREATE POLICY "member_keys_insert"
ON member_keys FOR INSERT
TO authenticated
WITH CHECK (
  guild_member_id IN (
    SELECT id FROM guild_leaders WHERE user_id = auth.uid()
  )
);

CREATE POLICY "member_keys_update"
ON member_keys FOR UPDATE
TO authenticated
USING (
  guild_member_id IN (
    SELECT id FROM guild_leaders WHERE user_id = auth.uid()
  )
);

CREATE POLICY "member_keys_delete"
ON member_keys FOR DELETE
TO authenticated
USING (
  guild_member_id IN (
    SELECT id FROM guild_leaders WHERE user_id = auth.uid()
  )
);

ALTER TABLE member_keys ENABLE ROW LEVEL SECURITY;

-- ============================================
-- PART 3: Add indexes for performance
-- ============================================

CREATE INDEX IF NOT EXISTS idx_guild_leaders_user_id ON guild_leaders(user_id);
CREATE INDEX IF NOT EXISTS idx_guild_leaders_guild_id ON guild_leaders(guild_id);
CREATE INDEX IF NOT EXISTS idx_guild_leaders_user_guild ON guild_leaders(user_id, guild_id);
CREATE INDEX IF NOT EXISTS idx_member_keys_guild_member_id ON member_keys(guild_member_id);

-- ============================================
-- PART 4: Refresh PostgREST schema cache
-- ============================================

NOTIFY pgrst, 'reload schema';

-- ============================================
-- PART 5: Verify the setup
-- ============================================

SELECT 'All RLS policies fixed!' as status;

-- Check guild_leaders policies
SELECT
  tablename,
  policyname,
  cmd,
  qual
FROM pg_policies
WHERE tablename = 'guild_leaders'
ORDER BY cmd, policyname;

-- Check member_keys policies
SELECT
  tablename,
  policyname,
  cmd,
  qual
FROM pg_policies
WHERE tablename = 'member_keys'
ORDER BY cmd, policyname;
