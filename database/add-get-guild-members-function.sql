-- Function to get guild members with auth.users data
-- This allows us to join guild_members with auth.users
CREATE OR REPLACE FUNCTION get_all_guild_members()
RETURNS TABLE (
  guild_id TEXT,
  user_id UUID,
  role TEXT,
  joined_at TIMESTAMPTZ,
  email TEXT,
  display_name TEXT
)
SECURITY DEFINER -- Run with elevated privileges to access auth schema
AS $$
BEGIN
  RETURN QUERY
  SELECT
    gm.guild_id,
    gm.user_id,
    gm.role,
    gm.joined_at,
    au.email,
    COALESCE(
      au.raw_user_meta_data->>'display_name',
      SPLIT_PART(au.email, '@', 1)
    ) AS display_name
  FROM guild_members gm
  INNER JOIN auth.users au ON au.id = gm.user_id
  ORDER BY gm.role DESC, gm.joined_at ASC;
END;
$$ LANGUAGE plpgsql;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION get_all_guild_members() TO authenticated;
