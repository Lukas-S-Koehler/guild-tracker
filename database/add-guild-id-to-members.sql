-- Migration: Add guild_id to members table for proper multi-guild support
-- This allows the same IGN to exist in multiple guilds

-- ============================================
-- 1. Add guild_id column to members table
-- ============================================

-- First, add the column as nullable
ALTER TABLE members ADD COLUMN IF NOT EXISTS guild_id TEXT;

-- ============================================
-- 2. Migrate existing data
-- ============================================

-- For existing members, set guild_id from guild_config
-- This assumes you have one guild currently
UPDATE members
SET guild_id = (SELECT guild_id FROM guild_config LIMIT 1)
WHERE guild_id IS NULL;

-- ============================================
-- 3. Make guild_id NOT NULL and add constraints
-- ============================================

-- Now make it NOT NULL
ALTER TABLE members ALTER COLUMN guild_id SET NOT NULL;

-- Add foreign key constraint
ALTER TABLE members
ADD CONSTRAINT fk_members_guild
FOREIGN KEY (guild_id) REFERENCES guild_config(guild_id) ON DELETE CASCADE;

-- ============================================
-- 4. Update unique constraint
-- ============================================

-- Drop the old unique constraint on just IGN
ALTER TABLE members DROP CONSTRAINT IF EXISTS members_ign_key;

-- Add new composite unique constraint (guild_id + ign)
-- This allows the same IGN in different guilds
ALTER TABLE members
ADD CONSTRAINT members_guild_ign_unique
UNIQUE (guild_id, ign);

-- ============================================
-- 5. Update indexes
-- ============================================

-- Drop old index if exists
DROP INDEX IF EXISTS idx_members_ign;

-- Create composite index for faster lookups
CREATE INDEX IF NOT EXISTS idx_members_guild_ign ON members(guild_id, ign);
CREATE INDEX IF NOT EXISTS idx_members_guild ON members(guild_id);

-- ============================================
-- 6. Add guild_id to idlemmo_id unique constraint
-- ============================================

-- If idlemmo_id column exists, update its constraint too
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'members' AND column_name = 'idlemmo_id'
  ) THEN
    -- Drop old unique constraint
    ALTER TABLE members DROP CONSTRAINT IF EXISTS members_idlemmo_id_key;

    -- Add composite unique constraint
    ALTER TABLE members
    ADD CONSTRAINT members_guild_idlemmo_unique
    UNIQUE (guild_id, idlemmo_id);
  END IF;
END $$;

-- ============================================
-- Done!
-- ============================================
-- Now members are properly scoped to guilds:
-- - Same IGN can exist in multiple guilds
-- - All queries must filter by guild_id
-- - Foreign key ensures data integrity
