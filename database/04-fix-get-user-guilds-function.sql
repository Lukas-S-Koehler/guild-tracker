-- Fix get_user_guilds function to be more reliable and faster
-- This version joins with the guilds table instead of guild_config
-- to avoid issues with missing guild_config entries
-- Optimized for fast return even when user has no guilds

CREATE OR REPLACE FUNCTION get_user_guilds()
RETURNS TABLE (
  guild_id TEXT,
  guild_name TEXT,
  role TEXT,
  joined_at TIMESTAMPTZ
)
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
  -- Fast path: return empty if user has no memberships
  IF NOT EXISTS (SELECT 1 FROM guild_members WHERE user_id = auth.uid() LIMIT 1) THEN
    RETURN;
  END IF;

  -- User has guilds, fetch them
  RETURN QUERY
  SELECT
    gm.guild_id,
    g.name AS guild_name,
    gm.role,
    gm.joined_at
  FROM guild_members gm
  INNER JOIN guilds g ON g.id = gm.guild_id
  WHERE gm.user_id = auth.uid()
  ORDER BY gm.joined_at ASC;
END;
$$ LANGUAGE plpgsql;

-- Create index on user_id for fast lookups (if not exists)
CREATE INDEX IF NOT EXISTS idx_guild_members_user_id ON guild_members(user_id);

-- Grant execute permission
GRANT EXECUTE ON FUNCTION get_user_guilds() TO authenticated;

-- Test the function (should return quickly even with no guilds)
SELECT * FROM get_user_guilds();
