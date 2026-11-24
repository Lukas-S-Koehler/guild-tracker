-- ============================================================================
-- Dream Hub step 14 (F7): kudos
--
-- * kudos : one row per kudos given. Givers are website users with an approved claim
--           (their whole account bundle counts as one giver). Recipients are characters;
--           the account (member_alts closure) is resolved at read time, so alts pool.
--           Limits live in src/lib/kudos.ts: 3 per giver per week (Monday UTC),
--           1 per recipient account per giver per week, never to your own account.
-- Depends on: auth.users, members
-- Safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS kudos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  giver_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  giver_member_id UUID REFERENCES members(id) ON DELETE SET NULL,
  recipient_member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 200),
  week_start DATE NOT NULL,
  source TEXT NOT NULL DEFAULT 'web' CHECK (source IN ('web', 'discord')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_kudos_recipient ON kudos(recipient_member_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kudos_giver_week ON kudos(giver_user_id, week_start);
CREATE INDEX IF NOT EXISTS idx_kudos_week ON kudos(week_start);

-- Server-side only (service role). No direct client access.
ALTER TABLE kudos ENABLE ROW LEVEL SECURITY;
