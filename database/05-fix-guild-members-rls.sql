-- Fix RLS policies on guild_members table to allow users to see their own memberships
-- This fixes the "no guilds found" issue

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view their own memberships" ON guild_members;
DROP POLICY IF EXISTS "Users can view members in their guilds" ON guild_members;
DROP POLICY IF EXISTS "Officers can manage members" ON guild_members;
DROP POLICY IF EXISTS "Leaders can manage members" ON guild_members;

-- Enable RLS
ALTER TABLE guild_members ENABLE ROW LEVEL SECURITY;

-- Policy 1: Users can view their own guild memberships (CRITICAL for login)
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

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON guild_members TO authenticated;

-- Verify: Test that users can see their own memberships
SELECT 'Testing guild_members query:' as status;
SELECT guild_id, role, joined_at FROM guild_members WHERE user_id = auth.uid();
