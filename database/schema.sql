-- Guild Tracker Database Schema (Simplified)
-- Run this in your Supabase SQL Editor

-- Guild Configuration (single row)
CREATE TABLE IF NOT EXISTS guild_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_name TEXT,
  api_key TEXT NOT NULL,
  donation_requirement INTEGER DEFAULT 5000,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Members (auto-populated from activity logs)
CREATE TABLE IF NOT EXISTS members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ign TEXT NOT NULL UNIQUE,
  first_seen DATE,
  last_seen DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Daily Logs
CREATE TABLE IF NOT EXISTS daily_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  log_date DATE NOT NULL DEFAULT CURRENT_DATE,
  raids INTEGER DEFAULT 0,
  gold_donated INTEGER DEFAULT 0,
  met_requirement BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(member_id, log_date)
);

-- Market Cache (for item prices)
CREATE TABLE IF NOT EXISTS market_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_name TEXT NOT NULL UNIQUE,
  item_id TEXT,
  price INTEGER NOT NULL,
  cached_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_members_ign ON members(ign);
CREATE INDEX IF NOT EXISTS idx_daily_logs_date ON daily_logs(log_date);
CREATE INDEX IF NOT EXISTS idx_daily_logs_member ON daily_logs(member_id);
CREATE INDEX IF NOT EXISTS idx_market_cache_name ON market_cache(item_name);

-- Enable Row Level Security
ALTER TABLE guild_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE members ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_cache ENABLE ROW LEVEL SECURITY;

-- Create policies (allow all for simplicity - adjust for production)
CREATE POLICY "Allow all on guild_config" ON guild_config FOR ALL USING (true);
CREATE POLICY "Allow all on members" ON members FOR ALL USING (true);
CREATE POLICY "Allow all on daily_logs" ON daily_logs FOR ALL USING (true);
CREATE POLICY "Allow all on market_cache" ON market_cache FOR ALL USING (true);
