-- ============================================================================
-- Account claims: website users ↔ IdleMMO characters, with derived guild access
--
-- * A user requests a character from any guild in `guilds`; super admin or a
--   LEADER/DEPUTY/OFFICER of that character's current guild approves it.
-- * One approved owner per character. Approving one character covers its alts
--   (member_alts closure), which are resolved at read time and never stored.
-- * guild_leaders rows get a `source`:
--     'derived' — kept in sync with the in-game position of the user's
--                 characters (LEADER/DEPUTY/OFFICER, SOLDIER/RECRUIT → MEMBER).
--                 Added/updated/removed automatically.
--     'manual'  — super admin override. Never touched by the sync.
--   All existing rows are treated as manual.
-- Depends on: auth.users, members, guilds, guild_leaders, member_alts
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_characters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  note TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  UNIQUE (user_id, member_id)
);
CREATE INDEX IF NOT EXISTS idx_user_characters_user ON user_characters(user_id);
CREATE INDEX IF NOT EXISTS idx_user_characters_status ON user_characters(status);
-- A character can only be approved for one website account.
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_characters_one_owner
  ON user_characters(member_id) WHERE status = 'approved';

ALTER TABLE user_characters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_characters_own_read" ON user_characters;
CREATE POLICY "user_characters_own_read" ON user_characters
  FOR SELECT USING (auth.uid() = user_id);
-- Writes go through the API (service role).

ALTER TABLE guild_leaders
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual'
  CHECK (source IN ('manual', 'derived'));
