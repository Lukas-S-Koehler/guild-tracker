-- Find user by display_name (username), case-insensitive.
-- Falls back to the email prefix (default display_name when meta is absent).
CREATE OR REPLACE FUNCTION find_user_by_username(search_username TEXT)
RETURNS TABLE (
  id UUID,
  email TEXT,
  display_name TEXT
)
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    au.id,
    au.email,
    COALESCE(
      au.raw_user_meta_data->>'display_name',
      SPLIT_PART(au.email, '@', 1)
    ) AS display_name
  FROM auth.users au
  WHERE LOWER(COALESCE(
      au.raw_user_meta_data->>'display_name',
      SPLIT_PART(au.email, '@', 1)
    )) = LOWER(search_username);
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION find_user_by_username(TEXT) TO authenticated;
