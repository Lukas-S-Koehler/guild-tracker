-- ============================================
-- FIX CRITICAL FOREIGN KEY CONSTRAINT ISSUE
-- ============================================
-- The guild_members table has the WRONG foreign key!
-- Currently: guild_members.guild_id → guild_config.guild_id
-- Should be: guild_members.guild_id → guilds.id
-- ============================================

-- Drop the incorrect foreign key constraint
ALTER TABLE guild_members
DROP CONSTRAINT IF EXISTS guild_members_guild_id_fkey;

-- Add the CORRECT foreign key constraint pointing directly to guilds table
ALTER TABLE guild_members
ADD CONSTRAINT guild_members_guild_id_fkey
FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE CASCADE;

-- Verify the fix
DO $$
BEGIN
  RAISE NOTICE '===========================================';
  RAISE NOTICE 'FOREIGN KEY FIX COMPLETE';
  RAISE NOTICE '===========================================';
  RAISE NOTICE 'guild_members.guild_id now points to guilds.id (CORRECT)';
  RAISE NOTICE 'You can now add members to ANY guild, not just those with guild_config entries';
  RAISE NOTICE '===========================================';
END $$;

-- Check current foreign keys to verify
SELECT
  'Current Foreign Keys' as section,
  tc.table_name,
  tc.constraint_name,
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_name = 'guild_members'
  AND kcu.column_name = 'guild_id';
