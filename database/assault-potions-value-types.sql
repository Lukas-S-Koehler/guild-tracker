-- Differentiate flat vs percentage combat stat bonuses
ALTER TABLE combat_potions ADD COLUMN IF NOT EXISTS attack_power_is_percentage BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE combat_potions ADD COLUMN IF NOT EXISTS protection_is_percentage BOOLEAN NOT NULL DEFAULT FALSE;
