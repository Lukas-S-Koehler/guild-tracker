-- Correct migration for your actual database schema
-- This works with the schema you showed me (with guild_id, idlemmo_id, etc.)

-- Make idlemmo_id nullable (since activity logs don't have IdleMMO IDs)
ALTER TABLE members ALTER COLUMN idlemmo_id DROP NOT NULL;

-- Make position nullable or set a default
ALTER TABLE members ALTER COLUMN position DROP NOT NULL;
ALTER TABLE members ALTER COLUMN position SET DEFAULT 'SOLDIER';

-- Add the missing columns for activity tracking
ALTER TABLE members
ADD COLUMN IF NOT EXISTS last_seen DATE,
ADD COLUMN IF NOT EXISTS first_seen DATE;

-- Ensure ign is unique for lookups
-- First check if index exists, if not create it
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE indexname = 'idx_members_ign_unique'
    ) THEN
        CREATE UNIQUE INDEX idx_members_ign_unique ON members(ign);
    END IF;
END $$;

-- Update the unique constraint on members to allow nullable idlemmo_id
ALTER TABLE members DROP CONSTRAINT IF EXISTS members_guild_id_idlemmo_id_key;

-- Done! Now activity logs can create/update members with just IGN
