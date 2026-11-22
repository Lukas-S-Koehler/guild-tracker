-- Migration to make members table work with activity log imports
-- Your current schema requires guild_id and idlemmo_id, but activity logs only have IGN
-- We need to make these fields nullable for manual activity log imports

-- Make idlemmo_id nullable (since activity logs don't have IdleMMO IDs)
ALTER TABLE members ALTER COLUMN idlemmo_id DROP NOT NULL;

-- Make guild_id nullable temporarily for activity imports
-- (ideally we'd set a default guild_id, but we'll handle this in the application)
ALTER TABLE members ALTER COLUMN guild_id DROP NOT NULL;

-- Add the missing columns for activity tracking
ALTER TABLE members
ADD COLUMN IF NOT EXISTS last_seen DATE,
ADD COLUMN IF NOT EXISTS first_seen DATE;

-- Ensure ign is unique for upsert operations
DROP INDEX IF EXISTS idx_members_ign;
CREATE UNIQUE INDEX IF NOT EXISTS idx_members_ign_unique ON members(ign) WHERE ign IS NOT NULL;

-- Update the unique constraint to work with nullable guild_id
ALTER TABLE members DROP CONSTRAINT IF EXISTS members_guild_id_idlemmo_id_key;
-- Don't recreate this constraint since idlemmo_id is now nullable

-- Done! Now activity logs can create members with just IGN
