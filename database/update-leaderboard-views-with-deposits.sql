-- Update leaderboard views to include deposits_gold in total gold and activity score
-- This ensures the leaderboard calculates: Score = (Raids × 1,000) + Total Gold (donations + deposits)

-- View for cross-guild leaderboard
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
  COUNT(DISTINCT dl.log_date) AS days_active
FROM members m
LEFT JOIN guilds g ON g.id = m.current_guild_id
LEFT JOIN daily_logs dl ON dl.member_id = m.id
WHERE m.is_active = true
GROUP BY m.id, m.ign, g.nickname, g.name, m.current_guild_id
ORDER BY activity_score DESC;

-- View for weekly leaderboard
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
  COUNT(DISTINCT dl.log_date) AS days_active
FROM members m
LEFT JOIN guilds g ON g.id = m.current_guild_id
LEFT JOIN daily_logs dl ON dl.member_id = m.id
WHERE m.is_active = true
  AND dl.log_date >= CURRENT_DATE - INTERVAL '7 days'
GROUP BY m.id, m.ign, g.nickname, g.name, m.current_guild_id
ORDER BY activity_score DESC;

-- View for monthly leaderboard
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
  COUNT(DISTINCT dl.log_date) AS days_active
FROM members m
LEFT JOIN guilds g ON g.id = m.current_guild_id
LEFT JOIN daily_logs dl ON dl.member_id = m.id
WHERE m.is_active = true
  AND dl.log_date >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY m.id, m.ign, g.nickname, g.name, m.current_guild_id
ORDER BY activity_score DESC;

-- Summary:
-- Updated all three leaderboard views to:
-- 1. Include deposits_gold in total_gold calculation
-- 2. Include deposits_gold in activity_score calculation
-- This ensures members get credit for both challenge donations and guild hall deposits
