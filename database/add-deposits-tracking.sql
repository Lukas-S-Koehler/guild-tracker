-- Add deposits_gold column to track guild hall deposits
ALTER TABLE daily_logs
ADD COLUMN IF NOT EXISTS deposits_gold NUMERIC DEFAULT 0;

-- Add comment
COMMENT ON COLUMN daily_logs.deposits_gold IS 'Total gold value of guild hall deposits';

-- Add index for queries
CREATE INDEX IF NOT EXISTS idx_daily_logs_deposits
ON daily_logs(deposits_gold DESC);
