-- ============================================
-- Rename guild_members table to guild_leaders
-- Run this in your Supabase SQL Editor
-- ============================================

-- Step 1: Rename the table
ALTER TABLE IF EXISTS guild_members RENAME TO guild_leaders;

-- Step 2: Update the foreign key constraint in member_keys table
-- Drop the old constraint
ALTER TABLE member_keys
DROP CONSTRAINT IF EXISTS member_keys_guild_member_id_fkey;

-- Add the new constraint pointing to the renamed table
-- Keep the column name as guild_member_id (code references it)
ALTER TABLE member_keys
ADD CONSTRAINT member_keys_guild_member_id_fkey
FOREIGN KEY (guild_member_id) REFERENCES guild_leaders(id) ON DELETE CASCADE;

-- Step 3: Update RLS policies to reference the new table name
-- Drop old policies
DROP POLICY IF EXISTS "Allow authenticated users to view guild members" ON guild_leaders;
DROP POLICY IF EXISTS "Authenticated users can view all guild members" ON guild_leaders;

-- Recreate policies with correct table name
CREATE POLICY "Authenticated users can view all guild leaders"
  ON guild_leaders FOR SELECT
  TO authenticated
  USING (true);

-- Step 4: Refresh the schema cache
NOTIFY pgrst, 'reload schema';

-- Verify the changes
SELECT 'Table renamed successfully!' as status;
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'guild_leaders';

-- Verify foreign key constraint
SELECT
  tc.constraint_name,
  tc.table_name,
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
WHERE tc.table_name = 'member_keys'
  AND tc.constraint_type = 'FOREIGN KEY';
