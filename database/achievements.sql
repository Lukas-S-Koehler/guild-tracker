-- Dream Hub Phase 2, step 9: achievements + titles.
-- Catalogue lives in code (src/lib/achievements.ts). An achievement is earned per account
-- (main + alts); the unlock row is written for every character of the account so regrouping
-- alts never loses one. Run once in the Supabase SQL editor.

CREATE TABLE IF NOT EXISTS achievement_unlocks (
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  achievement_key TEXT NOT NULL,
  unlocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),   -- when the threshold was crossed (backfilled from history)
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),   -- when the evaluator wrote the row
  backfilled BOOLEAN NOT NULL DEFAULT FALSE,         -- unlocked by the launch backfill (never announced)
  announced_at TIMESTAMPTZ,                          -- posted in the #hall-of-fame digest (or skipped)
  PRIMARY KEY (member_id, achievement_key)
);
CREATE INDEX IF NOT EXISTS idx_achievement_unlocks_key ON achievement_unlocks(achievement_key);
CREATE INDEX IF NOT EXISTS idx_achievement_unlocks_unannounced ON achievement_unlocks(announced_at) WHERE announced_at IS NULL;
ALTER TABLE achievement_unlocks ENABLE ROW LEVEL SECURITY;
-- Service role only (read through the API).

-- Selected title (D5), one per website user. Must be a Gold+ achievement of their account (checked in the API).
CREATE TABLE IF NOT EXISTS user_titles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  achievement_key TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE user_titles ENABLE ROW LEVEL SECURITY;
-- Service role only.
