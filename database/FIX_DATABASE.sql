-- Quick Fix: Update guild_config table and create function
-- Run this in Supabase SQL Editor

-- Step 1: Add missing column to guild_config (if it doesn't exist)
ALTER TABLE guild_config
ADD COLUMN IF NOT EXISTS donation_requirement INTEGER DEFAULT 5000;

-- Step 2: Make sure guild_id is unique (needed for multi-guild)
-- First check if constraint exists, then add if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'guild_config_guild_id_key'
  ) THEN
    ALTER TABLE guild_config ADD CONSTRAINT guild_config_guild_id_key UNIQUE (guild_id);
  END IF;
END $$;

-- Step 3: Ensure your guild_config exists
INSERT INTO guild_config (guild_id, guild_name, api_key, donation_requirement)
VALUES ('554', 'Your Guild Name', '', 5000)
ON CONFLICT (guild_id) DO UPDATE
SET guild_name = EXCLUDED.guild_name;

-- Step 4: Create get_user_guilds function
CREATE OR REPLACE FUNCTION get_user_guilds()
RETURNS TABLE (
  guild_id TEXT,
  guild_name TEXT,
  role TEXT,
  joined_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    gm.guild_id,
    gc.guild_name,
    gm.role,
    gm.joined_at
  FROM guild_members gm
  JOIN guild_config gc ON gc.guild_id = gm.guild_id
  WHERE gm.user_id = auth.uid()
  ORDER BY gm.joined_at ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 5: Test the function (should return your guild)
SELECT * FROM get_user_guilds();

-- Step 6: Debug info
SELECT 'Debug Info:' as info;
SELECT 'Current User:' as label, auth.uid() as value;
SELECT 'Guild Configs:' as label;
SELECT guild_id, guild_name FROM guild_config;
SELECT 'Guild Memberships:' as label;
SELECT guild_id, user_id, role FROM guild_members WHERE guild_id = '554';
SELECT 'Function Result:' as label;
SELECT * FROM get_user_guilds();
