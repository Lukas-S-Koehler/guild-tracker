-- Dream Hub Phase 2, step 15 (D6): Dream Pass + Discord levels. Spec: docs/dream-pass.md.
-- Run once in the Supabase SQL editor. All tables are service-role only (read through the API).

-- Pass XP per account per season, recomputed daily from source data by /api/cron/dream-pass.
-- One row per CHARACTER of the account (same totals on each), so any character id finds its account.
-- season = 'YYYY-MM' (calendar month, UTC) or 'lifetime'.
CREATE TABLE IF NOT EXISTS dream_pass_scores (
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  season TEXT NOT NULL,
  account_key TEXT NOT NULL,          -- stable within one run; groups the characters of an account
  is_main BOOLEAN NOT NULL DEFAULT FALSE, -- exactly one row per account+season: use it for leaderboards
  xp INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 0,
  breakdown JSONB NOT NULL DEFAULT '{}'::jsonb, -- source → xp
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (member_id, season)
);
CREATE INDEX IF NOT EXISTS idx_dream_pass_scores_board ON dream_pass_scores (season, is_main, xp DESC);
ALTER TABLE dream_pass_scores ENABLE ROW LEVEL SECURITY;

-- Finished seasons: frozen 2 days after the month ends. Champions = top 10 (main member ids + Discord ids).
CREATE TABLE IF NOT EXISTS dream_pass_seasons (
  season TEXT PRIMARY KEY,
  finalized_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  standings JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{ place, member_id, ign, xp, level, discord_id }]
  announced_at TIMESTAMPTZ
);
ALTER TABLE dream_pass_seasons ENABLE ROW LEVEL SECURITY;

-- Discord chat: one row per human message in a member channel that passed the length filter.
-- No content stored. The 60 s cooldown is applied when counting, so the order of reading doesn't matter.
CREATE TABLE IF NOT EXISTS discord_chat_messages (
  message_id TEXT PRIMARY KEY,
  discord_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_discord_chat_author ON discord_chat_messages (discord_id, sent_at);
ALTER TABLE discord_chat_messages ENABLE ROW LEVEL SECURITY;

-- Read cursor per channel (newest message id read). Missing row = read from the start of the channel.
CREATE TABLE IF NOT EXISTS discord_chat_cursors (
  channel_id TEXT PRIMARY KEY,
  channel_name TEXT,
  last_message_id TEXT NOT NULL DEFAULT '0',
  caught_up BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE discord_chat_cursors ENABLE ROW LEVEL SECURITY;

-- Level-up milestones already posted to #hall-of-fame (season + account main + level).
CREATE TABLE IF NOT EXISTS dream_pass_milestones (
  season TEXT NOT NULL,
  account_key TEXT NOT NULL,
  level INTEGER NOT NULL,
  member_id UUID REFERENCES members(id) ON DELETE CASCADE,
  reached_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  announced_at TIMESTAMPTZ,
  PRIMARY KEY (season, account_key, level)
);
ALTER TABLE dream_pass_milestones ENABLE ROW LEVEL SECURITY;
