-- Fix get_user_guilds function to be more reliable
-- This version joins with the guilds table instead of guild_config
-- to avoid issues with missing guild_config entries

CREATE OR REPLACE FUNCTION get_user_guilds()
RETURNS TABLE (
  guild_id TEXT,
  guild_name TEXT,
  role TEXT,
  joined_at TIMESTAMPTZ
)
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    gm.guild_id,
    g.name AS guild_name,
    gm.role,
    gm.joined_at
  FROM guild_members gm
  JOIN guilds g ON g.id = gm.guild_id
  WHERE gm.user_id = auth.uid()
  ORDER BY gm.joined_at ASC;
END;
$$ LANGUAGE plpgsql;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION get_user_guilds() TO authenticated;

-- Test the function
SELECT * FROM get_user_guilds();
