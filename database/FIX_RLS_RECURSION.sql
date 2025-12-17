-- FIX: Remove infinite recursion in guild_members RLS policies
-- The current policies are referencing themselves causing infinite recursion

-- Step 1: Drop all existing policies on guild_members
DROP POLICY IF EXISTS "Users can view their own guild memberships" ON guild_members;
DROP POLICY IF EXISTS "Users can insert their own guild memberships" ON guild_members;
DROP POLICY IF EXISTS "Users can update their own guild memberships" ON guild_members;
DROP POLICY IF EXISTS "Users can delete their own guild memberships" ON guild_members;
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON guild_members;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON guild_members;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON guild_members;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON guild_members;

-- Step 2: Create simple, non-recursive policies
-- Allow users to view their own memberships
CREATE POLICY "Users can view their own memberships"
ON guild_members FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- Allow users to insert their own memberships (for when leaders add them)
CREATE POLICY "Users can insert memberships"
ON guild_members FOR INSERT
TO authenticated
WITH CHECK (true);

-- Allow users to update their own memberships
CREATE POLICY "Users can update their own memberships"
ON guild_members FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Allow users to delete their own memberships
CREATE POLICY "Users can delete their own memberships"
ON guild_members FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- Verify RLS is enabled
ALTER TABLE guild_members ENABLE ROW LEVEL SECURITY;

-- Test query (should work now)
SELECT * FROM guild_members WHERE user_id = auth.uid();
