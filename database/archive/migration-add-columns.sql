-- Migration: Add missing columns to existing tables
-- Run this in your Supabase SQL Editor if you already have tables created

-- First, remove guild_id from members table if it exists (it shouldn't be there)
ALTER TABLE members DROP COLUMN IF EXISTS guild_id;

-- Add missing columns to members table
ALTER TABLE members
ADD COLUMN IF NOT EXISTS last_seen DATE,
ADD COLUMN IF NOT EXISTS first_seen DATE;

-- Add unique constraint on ign column for upsert operations
-- First, ensure there are no duplicate ign values
DO $$
BEGIN
    -- Try to add the unique constraint
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'members_ign_key'
    ) THEN
        ALTER TABLE members ADD CONSTRAINT members_ign_key UNIQUE (ign);
    END IF;
END $$;

-- Add guild_id to guild_config
ALTER TABLE guild_config
ADD COLUMN IF NOT EXISTS guild_id TEXT;

-- Create challenges table if it doesn't exist
CREATE TABLE IF NOT EXISTS challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id TEXT NOT NULL,
  challenge_date DATE NOT NULL,
  raw_input TEXT,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_cost INTEGER DEFAULT 0,
  is_completed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(guild_id, challenge_date)
);

-- Add indexes for challenges
CREATE INDEX IF NOT EXISTS idx_challenges_date ON challenges(challenge_date);
CREATE INDEX IF NOT EXISTS idx_challenges_guild ON challenges(guild_id);

-- Enable RLS on challenges
ALTER TABLE challenges ENABLE ROW LEVEL SECURITY;

-- Create policy for challenges
DROP POLICY IF EXISTS "Allow all on challenges" ON challenges;
CREATE POLICY "Allow all on challenges" ON challenges FOR ALL USING (true);

-- Done! Your database should now work with the activity tracker
