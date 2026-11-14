-- Allow STANDARD quality tier (Dungeon Potion returns STANDARD from API)
ALTER TABLE combat_potions DROP CONSTRAINT IF EXISTS combat_potions_quality_check;
ALTER TABLE combat_potions ADD CONSTRAINT combat_potions_quality_check
  CHECK (quality IN ('STANDARD','PREMIUM','EPIC','LEGENDARY','MYTHIC'));

ALTER TABLE xp_potions DROP CONSTRAINT IF EXISTS xp_potions_quality_check;
ALTER TABLE xp_potions ADD CONSTRAINT xp_potions_quality_check
  CHECK (quality IN ('STANDARD','PREMIUM','EPIC','LEGENDARY','MYTHIC'));
