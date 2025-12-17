-- Function to find user by email
-- This allows us to search auth.users from our API
CREATE OR REPLACE FUNCTION find_user_by_email(search_email TEXT)
RETURNS TABLE (
  id UUID,
  email TEXT
)
SECURITY DEFINER -- Run with elevated privileges to access auth schema
AS $$
BEGIN
  RETURN QUERY
  SELECT
    au.id,
    au.email
  FROM auth.users au
  WHERE LOWER(au.email) = LOWER(search_email);
END;
$$ LANGUAGE plpgsql;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION find_user_by_email(TEXT) TO authenticated;
