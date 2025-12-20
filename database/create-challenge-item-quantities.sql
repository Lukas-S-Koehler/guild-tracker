-- Create table for fixed challenge item initial quantities
-- This stores the baseline quantity for each challenge item
-- Used to calculate 50% requirement without needing daily challenge entry

CREATE TABLE IF NOT EXISTS challenge_item_quantities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_name TEXT NOT NULL UNIQUE,
  initial_quantity INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for fast lookups by item name
CREATE INDEX IF NOT EXISTS idx_challenge_item_quantities_item_name
ON challenge_item_quantities(LOWER(item_name));

-- Enable RLS
ALTER TABLE challenge_item_quantities ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read challenge quantities
CREATE POLICY "Allow all authenticated users to read challenge quantities"
  ON challenge_item_quantities FOR SELECT
  USING (auth.role() = 'authenticated');

-- Only officers and leaders can insert/update quantities
CREATE POLICY "Officers can manage challenge quantities"
  ON challenge_item_quantities FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM guild_leaders
      WHERE user_id = auth.uid()
      AND role IN ('OFFICER', 'LEADER')
    )
  );

-- Add trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_challenge_item_quantities_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_challenge_item_quantities_timestamp
  BEFORE UPDATE ON challenge_item_quantities
  FOR EACH ROW
  EXECUTE FUNCTION update_challenge_item_quantities_timestamp();

-- Insert initial data from CSV (excluding empty values)
INSERT INTO challenge_item_quantities (item_name, initial_quantity) VALUES
('Abyssal Scroll', 5),
('Aetherial Feather Quill', 35),
('Air Elemental Essence', 20),
('Arcane Starstone', 1),
('Birch Log', 1320),
('Black Bear Pelt', 20),
('Boar Tusk', 22),
('Bone Fragment', 200),
('Broken Dwarven Plate', 15),
('Buffalo Horn', 120),
('Chest of Scraps', 15),
('Chromite Bar', 575),
('Chromite Ore', 900),
('Claw of the Alpha', 35),
('Coal Ore', 3000),
('Cod', 2400),
('Copper Bar', 1500),
('Copper Ore', 2400),
('Crab', 660),
('Cursed Blade Fragment', 35),
('Cursed Cloth', 70),
('Cursed Talisman', 90),
('Deer Antler', 130),
('Djinn''s Bottle', 100),
('Ducks Mouth', 80),
('Dwarven Whetstone', 90),
('Earth Elemental Essence', 20),
('Elk Antler', 75),
('Enigmatic Stone', 30),
('Essence of Shadows', 50),
('Fire Elemental Essence', 20),
('Forbidden Tome', 20),
('Goblin Crown', 10),
('Goblin Pouch', 150),
('Goblin Scraps', 60),
('Goblin Totem', 200),
('Golem Core Fragment', 35),
('Great White Shark', 400),
('Harpy''s Wings', 70),
('Herring', 1000),
('Iron Bar', 975),
('Iron Ore', 1560),
('Ivory', 25),
('Lantern Fish', 440),
('Lead Bar', 825),
('Lead Ore', 1780),
('Lions Teeth', 25),
('Lobster', 740),
('Long Forgotten Necklace', 50),
('Lucky Rabbit Foot', 120),
('Mahogany Log', 820),
('Maple Log', 980),
('Mercury Bar', 625),
('Mercury Ore', 980),
('Minotaur Hide', 10),
('Minotaurs Horn', 75),
('Moose Antler', 70),
('Mystic Bar', 400),
('Mystic Ore', 654),
('Mystical Log', 650),
('Oak Log', 3000),
('Oceanic Essence', 35),
('Orb of Elemental Conjuring', 15),
('Parchment', 20),
('Perch', 1100),
('Pirates Code', 130),
('Polar Bear Pelt', 20),
('Raccoon Fur', 20),
('Raw Onion', 200),
('Ruined Robes', 35),
('Salmon', 1800),
('Sardines', 860),
('Siren''s Scales', 150),
('Siren''s Soulstone', 35),
('Slime Extract', 200),
('Snakes Head', 120),
('Spruce Log', 1560),
('Steel Bar', 725),
('Steel Ore', 1140),
('Stingray', 450),
('Stoneheart Core', 20),
('Swamp Juice', 30),
('Tin Bar', 1875),
('Tin Ore', 3000),
('Trout', 1300),
('Tuna', 1600),
('Turtle', 560),
('Umbral Claw', 30),
('Undying Crest', 10),
('Uranium Bar', 501),
('Uranium Ore', 820),
('Venom Extract', 12),
('Vial of Spectre Ectoplasm', 35),
('Vial of Wraith Ectoplasm', 90),
('Void Essence', 15),
('Water Elemental Essence', 20),
('Willow Log', 900),
('Wolf Pelt', 45)
ON CONFLICT (item_name) DO NOTHING;

-- Note: Items excluded (empty/— values):
-- Basilisk Venom Vial
-- Moonblood Tincture
-- Petrifying Gaze Crystal
-- Yew Log
-- These will be added when encountered in activity logs
