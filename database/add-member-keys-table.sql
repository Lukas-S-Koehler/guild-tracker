-- Create member_keys table for individual API keys per guild member
-- This allows each member to use their own IdleMMO API key instead of one key per guild
CREATE TABLE IF NOT EXISTS public.member_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_member_id uuid REFERENCES guild_members(id) ON DELETE CASCADE,
  api_key text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS member_keys_guild_member_id_idx ON public.member_keys(guild_member_id);

-- Enable RLS
ALTER TABLE public.member_keys ENABLE ROW LEVEL SECURITY;

-- Policy: Members can view their own API keys
CREATE POLICY "Users can view their own API keys"
  ON public.member_keys
  FOR SELECT
  USING (
    guild_member_id IN (
      SELECT id FROM guild_members WHERE user_id = auth.uid()
    )
  );

-- Policy: Members can insert their own API keys
CREATE POLICY "Users can insert their own API keys"
  ON public.member_keys
  FOR INSERT
  WITH CHECK (
    guild_member_id IN (
      SELECT id FROM guild_members WHERE user_id = auth.uid()
    )
  );

-- Policy: Members can update their own API keys
CREATE POLICY "Users can update their own API keys"
  ON public.member_keys
  FOR UPDATE
  USING (
    guild_member_id IN (
      SELECT id FROM guild_members WHERE user_id = auth.uid()
    )
  );

-- Policy: Members can delete their own API keys
CREATE POLICY "Users can delete their own API keys"
  ON public.member_keys
  FOR DELETE
  USING (
    guild_member_id IN (
      SELECT id FROM guild_members WHERE user_id = auth.uid()
    )
  );

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_keys TO authenticated;
