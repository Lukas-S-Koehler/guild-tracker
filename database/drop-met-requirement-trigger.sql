-- Drop the trigger that overwrites met_requirement
-- We now calculate met_requirement in application code based on quantity-based logic
-- (50% of any challenge item quantity OR gold >= donation_requirement)

DROP TRIGGER IF EXISTS trigger_update_met_requirement ON daily_logs;
DROP FUNCTION IF EXISTS update_met_requirement();

-- Note: met_requirement is now calculated and set by the application code
-- in /api/activity/route.ts based on:
-- 1. gold_donated >= donation_requirement (e.g., 5000)
-- 2. OR meets_challenge_quantity flag (50% of any challenge item)
-- 3. OR manual_override = true
