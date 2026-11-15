-- Find user by display_name (username), case-insensitive.
-- Falls back to the email prefix (default display_name when meta is absent).
-- Does NOT return email. Safe to re-run (drops old signature first).
DROP FUNCTION IF EXISTS find_user_by_username(TEXT);

CREATE OR REPLACE FUNCTION find_user_by_username(search_username TEXT)
RETURNS TABLE (
  id UUID,
  display_name TEXT
)
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  RETURN QUERY
  SELECT
    au.id,
    COALESCE(
      au.raw_user_meta_data->>'display_name',
      SPLIT_PART(au.email::TEXT, '@', 1)
    )::TEXT AS display_name
  FROM auth.users au
  WHERE LOWER(COALESCE(
      au.raw_user_meta_data->>'display_name',
      SPLIT_PART(au.email::TEXT, '@', 1)
    )) = LOWER(search_username);
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION find_user_by_username(TEXT) TO authenticated;
