-- Add character class to members (for market-locked leaderboard filter)
-- Market-locked classes: Banished, Cursed
ALTER TABLE members ADD COLUMN IF NOT EXISTS class TEXT;
CREATE INDEX IF NOT EXISTS idx_members_class ON members(class);

-- Rebuild leaderboard views to expose m.class.
-- CREATE OR REPLACE VIEW forbids column reorder/rename, so append `class` at end.
CREATE OR REPLACE VIEW v_global_leaderboard AS
SELECT
  m.id,
  m.ign,
  g.nickname AS guild_nickname,
  g.name AS guild_name,
  m.current_guild_id,
  COALESCE(SUM(dl.raids), 0) AS total_raids,
  COALESCE(SUM(dl.gold_donated), 0) + COALESCE(SUM(dl.deposits_gold), 0) AS total_gold,
  COALESCE(SUM(dl.raids), 0) * 1000 + COALESCE(SUM(dl.gold_donated), 0) + COALESCE(SUM(dl.deposits_gold), 0) AS activity_score,
  COUNT(DISTINCT dl.log_date) AS days_active,
  m.class
FROM members m
LEFT JOIN guilds g ON g.id = m.current_guild_id
LEFT JOIN daily_logs dl ON dl.member_id = m.id
WHERE m.is_active = true
GROUP BY m.id, m.ign, m.class, g.nickname, g.name, m.current_guild_id
ORDER BY activity_score DESC;

CREATE OR REPLACE VIEW v_weekly_leaderboard AS
SELECT
  m.id,
  m.ign,
  g.nickname AS guild_nickname,
  g.name AS guild_name,
  m.current_guild_id,
  COALESCE(SUM(dl.raids), 0) AS total_raids,
  COALESCE(SUM(dl.gold_donated), 0) + COALESCE(SUM(dl.deposits_gold), 0) AS total_gold,
  COALESCE(SUM(dl.raids), 0) * 1000 + COALESCE(SUM(dl.gold_donated), 0) + COALESCE(SUM(dl.deposits_gold), 0) AS activity_score,
  COUNT(DISTINCT dl.log_date) AS days_active,
  m.class
FROM members m
LEFT JOIN guilds g ON g.id = m.current_guild_id
LEFT JOIN daily_logs dl ON dl.member_id = m.id
WHERE m.is_active = true
  AND dl.log_date >= CURRENT_DATE - INTERVAL '7 days'
GROUP BY m.id, m.ign, m.class, g.nickname, g.name, m.current_guild_id
ORDER BY activity_score DESC;

CREATE OR REPLACE VIEW v_monthly_leaderboard AS
SELECT
  m.id,
  m.ign,
  g.nickname AS guild_nickname,
  g.name AS guild_name,
  m.current_guild_id,
  COALESCE(SUM(dl.raids), 0) AS total_raids,
  COALESCE(SUM(dl.gold_donated), 0) + COALESCE(SUM(dl.deposits_gold), 0) AS total_gold,
  COALESCE(SUM(dl.raids), 0) * 1000 + COALESCE(SUM(dl.gold_donated), 0) + COALESCE(SUM(dl.deposits_gold), 0) AS activity_score,
  COUNT(DISTINCT dl.log_date) AS days_active,
  m.class
FROM members m
LEFT JOIN guilds g ON g.id = m.current_guild_id
LEFT JOIN daily_logs dl ON dl.member_id = m.id
WHERE m.is_active = true
  AND dl.log_date >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY m.id, m.ign, m.class, g.nickname, g.name, m.current_guild_id
ORDER BY activity_score DESC;
