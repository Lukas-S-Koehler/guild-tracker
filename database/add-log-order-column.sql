-- Add log_order column to track chronological order from Discord activity log
-- Lower values = more recent (first entries in the Discord log)

ALTER TABLE daily_logs
ADD COLUMN IF NOT EXISTS log_order INTEGER DEFAULT 999;

-- Create index for efficient ordering
CREATE INDEX IF NOT EXISTS idx_daily_logs_log_order
ON daily_logs(log_date DESC, log_order ASC);

COMMENT ON COLUMN daily_logs.log_order IS 'Chronological order from Discord log (0 = most recent)';
