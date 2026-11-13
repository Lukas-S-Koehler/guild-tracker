-- Search auth.users by display_name prefix (case-insensitive).
-- Returns up to `max_results` matches for autocomplete UIs.
-- Does NOT expose email addresses.
CREATE OR REPLACE FUNCTION search_users(search_query TEXT, max_results INT DEFAULT 20)
RETURNS TABLE (
  display_name TEXT
)
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT
    COALESCE(
      au.raw_user_meta_data->>'display_name',
      SPLIT_PART(au.email, '@', 1)
    ) AS display_name
  FROM auth.users au
  WHERE
    search_query IS NULL
    OR search_query = ''
    OR LOWER(COALESCE(
         au.raw_user_meta_data->>'display_name',
         SPLIT_PART(au.email, '@', 1)
       )) LIKE LOWER(search_query) || '%'
  ORDER BY display_name ASC
  LIMIT max_results;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION search_users(TEXT, INT) TO authenticated;
