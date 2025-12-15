-- Update the trigger function to work correctly with the members table

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
  member_guild_id TEXT;
BEGIN
  -- Get the guild_id from the member
  SELECT guild_id INTO member_guild_id
  FROM members
  WHERE id = NEW.member_id;

  -- Get settings from guild_config using the member's guild_id
  SELECT gc.settings INTO settings
  FROM guild_config gc
  WHERE gc.guild_id = member_guild_id;

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