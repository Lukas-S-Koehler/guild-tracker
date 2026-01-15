-- Migration: Make API keys account-based instead of guild-based
-- API keys are the same for all guilds a user belongs to, so store once per user

-- Create user_api_keys table
CREATE TABLE IF NOT EXISTS user_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  api_key TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Enable RLS
ALTER TABLE user_api_keys ENABLE ROW LEVEL SECURITY;

-- Users can only see/manage their own API key
DROP POLICY IF EXISTS "Users can view own API key" ON user_api_keys;
CREATE POLICY "Users can view own API key"
  ON user_api_keys FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own API key" ON user_api_keys;
CREATE POLICY "Users can insert own API key"
  ON user_api_keys FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own API key" ON user_api_keys;
CREATE POLICY "Users can update own API key"
  ON user_api_keys FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own API key" ON user_api_keys;
CREATE POLICY "Users can delete own API key"
  ON user_api_keys FOR DELETE
  USING (auth.uid() = user_id);

-- Migrate existing keys from member_keys to user_api_keys
-- Take the most recent key for each user if they have multiple
INSERT INTO user_api_keys (user_id, api_key, created_at, updated_at)
SELECT DISTINCT ON (gl.user_id)
  gl.user_id,
  mk.api_key,
  mk.created_at,
  mk.created_at -- Use created_at for both since member_keys doesn't have updated_at
FROM member_keys mk
JOIN guild_leaders gl ON gl.id = mk.guild_member_id
WHERE mk.api_key IS NOT NULL
ORDER BY gl.user_id, mk.created_at DESC
ON CONFLICT (user_id) DO NOTHING;

-- Verify migration
SELECT
  u.email,
  uak.api_key IS NOT NULL as has_key,
  uak.created_at
FROM auth.users u
LEFT JOIN user_api_keys uak ON uak.user_id = u.id
ORDER BY u.email;

COMMENT ON TABLE user_api_keys IS 'Stores IdleMMO API keys per user account (shared across all guilds)';
