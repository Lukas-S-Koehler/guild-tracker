-- Add allow_challenge_quantity_requirement toggle to guild_config settings
-- This allows guilds to enable/disable the 50% challenge item quantity requirement
-- Default: false (disabled for all guilds)

-- Update all existing guild_config records to add the new setting
UPDATE guild_config
SET settings = jsonb_set(
  COALESCE(settings, '{}'::jsonb),
  '{allow_challenge_quantity_requirement}',
  'false'::jsonb,
  true
)
WHERE settings IS NULL
   OR NOT settings ? 'allow_challenge_quantity_requirement';

-- Verify the update
SELECT
  guild_id,
  guild_name,
  settings->>'allow_challenge_quantity_requirement' as challenge_qty_enabled,
  settings->>'daily_donation_requirement' as donation_req,
  settings->>'daily_deposit_requirement' as deposit_req
FROM guild_config
ORDER BY guild_name;

COMMENT ON COLUMN guild_config.settings IS 'Guild settings including donation_requirement, daily_deposit_requirement, allow_challenge_quantity_requirement, etc.';
