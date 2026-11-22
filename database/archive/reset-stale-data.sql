-- Reset stale data: wipe members, daily_logs, donations
-- Keeps: guilds, guild_config, guild_leaders, challenges, market_cache, user_api_keys
-- Run this ONCE before activating the automated activity cron

-- Disable triggers temporarily
SET session_replication_role = replica;

TRUNCATE TABLE donations CASCADE;
TRUNCATE TABLE daily_logs CASCADE;
TRUNCATE TABLE members CASCADE;
TRUNCATE TABLE guild_activity_events CASCADE;

-- Re-enable triggers
SET session_replication_role = DEFAULT;

-- Verify
SELECT 'members' AS tbl, COUNT(*) FROM members
UNION ALL
SELECT 'daily_logs', COUNT(*) FROM daily_logs
UNION ALL
SELECT 'donations', COUNT(*) FROM donations
UNION ALL
SELECT 'guild_activity_events', COUNT(*) FROM guild_activity_events;
