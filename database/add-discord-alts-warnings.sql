-- Phase 1: Add Discord and hashed_id fields to members
ALTER TABLE members ADD COLUMN IF NOT EXISTS hashed_id TEXT;
ALTER TABLE members ADD COLUMN IF NOT EXISTS discord_id TEXT;
ALTER TABLE members ADD COLUMN IF NOT EXISTS discord_username TEXT;

-- Phase 2: Alt characters table
CREATE TABLE IF NOT EXISTS member_alts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  member_id UUID REFERENCES members(id) ON DELETE CASCADE,
  alt_ign TEXT NOT NULL,
  alt_hashed_id TEXT NOT NULL,
  alt_member_id UUID REFERENCES members(id) ON DELETE SET NULL,
  fetched_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(member_id, alt_hashed_id)
);

CREATE INDEX IF NOT EXISTS member_alts_member_idx ON member_alts(member_id);
CREATE INDEX IF NOT EXISTS member_alts_alt_member_idx ON member_alts(alt_member_id);
CREATE INDEX IF NOT EXISTS member_alts_alt_hashed_idx ON member_alts(alt_hashed_id);

-- Phase 3: Warnings table
CREATE TABLE IF NOT EXISTS warnings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  member_id UUID REFERENCES members(id) ON DELETE CASCADE,
  guild_id TEXT REFERENCES guilds(id),
  warning_level TEXT CHECK (warning_level IN ('warn1', 'warn2', 'kick')),
  reason TEXT,
  is_auto BOOLEAN DEFAULT false,
  discord_dm_sent BOOLEAN DEFAULT false,
  discord_dm_error TEXT,
  warned_by_discord_id TEXT,
  warned_by_ign TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS warnings_member_guild_idx ON warnings(member_id, guild_id, created_at DESC);
CREATE INDEX IF NOT EXISTS warnings_guild_idx ON warnings(guild_id, created_at DESC);

-- Phase 4: Update Dream Invaders guild config for weekly requirement
-- Note: Run this after the above DDL
UPDATE guild_config
SET settings = COALESCE(settings, '{}'::jsonb) || '{
  "requirement_period": "weekly",
  "weekly_donation_requirement": 35000,
  "deposits_only": true
}'::jsonb
WHERE guild_id = '138';
