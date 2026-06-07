-- Overflow bank: stores each member's running gold balance per guild
CREATE TABLE IF NOT EXISTS member_gold_bank (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  balance INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(member_id, guild_id)
);

-- Track per-day bank contributions so re-runs are idempotent
ALTER TABLE daily_logs ADD COLUMN IF NOT EXISTS bank_used INT NOT NULL DEFAULT 0;
ALTER TABLE daily_logs ADD COLUMN IF NOT EXISTS bank_earned INT NOT NULL DEFAULT 0;
-- Running bank balance after this day's contribution; used as starting point for next day
ALTER TABLE daily_logs ADD COLUMN IF NOT EXISTS bank_balance_after INT NOT NULL DEFAULT 0;
