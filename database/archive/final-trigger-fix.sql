-- Final fix for the trigger function
-- Since members table doesn't have guild_id, we just use the single guild_config row

-- Drop the old trigger and function
DROP TRIGGER IF EXISTS trigger_update_met_requirement ON daily_logs;
DROP FUNCTION IF EXISTS update_met_requirement();

-- Recreate the function with correct logic
CREATE OR REPLACE FUNCTION update_met_requirement()
RETURNS TRIGGER AS $$
DECLARE
  settings JSONB;
  donation_req NUMERIC;
  challenge_req NUMERIC;
BEGIN
  -- Get settings from guild_config (there's only one row)
  SELECT gc.settings INTO settings
  FROM guild_config gc
  LIMIT 1;

  donation_req := COALESCE((settings->>'donation_requirement')::NUMERIC, 5000);
  challenge_req := COALESCE((settings->>'challenge_requirement_percent')::NUMERIC, 50);

  NEW.met_requirement := (
    NEW.gold_donated >= donation_req OR
    NEW.challenge_contribution_percent >= challenge_req
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recreate the trigger
CREATE TRIGGER trigger_update_met_requirement
  BEFORE INSERT OR UPDATE ON daily_logs
  FOR EACH ROW
  EXECUTE FUNCTION update_met_requirement();

-- Done! The trigger will now work correctly
