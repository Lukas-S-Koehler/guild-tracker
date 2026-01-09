-- Create guild_buildings table to store building types and their resource requirements
CREATE TABLE IF NOT EXISTS guild_buildings (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  guild_level_required INTEGER NOT NULL,
  mark_cost INTEGER NOT NULL,
  resources JSONB NOT NULL, -- Array of {item: string, quantity: number}
  display_order INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert all guild building types with their resource requirements
INSERT INTO guild_buildings (id, name, description, guild_level_required, mark_cost, resources, display_order) VALUES
('foundation', 'Foundation', 'The foundation is needed to build the guild hall. Unlike other components, the foundation does not need maintenance/repairs.', 10, 10,
  '[
    {"item": "Oak Log", "quantity": 12500},
    {"item": "Willow Log", "quantity": 10000},
    {"item": "Mystical Log", "quantity": 5000},
    {"item": "Copper Bar", "quantity": 5000},
    {"item": "Mercury Bar", "quantity": 5000},
    {"item": "Uranium Bar", "quantity": 2500},
    {"item": "Mystic Bar", "quantity": 2500}
  ]'::jsonb, 1),

('slot', 'Slot', 'The slot is needed to add additional guild components. Unlike other components, slots do not need maintenance/repairs.', 0, 10,
  '[
    {"item": "Mahogany Log", "quantity": 15000},
    {"item": "Mystical Log", "quantity": 20000},
    {"item": "Chromite Bar", "quantity": 20000},
    {"item": "Mystic Bar", "quantity": 15000}
  ]'::jsonb, 2),

('teleportation_beacon', 'Teleportation Beacon', 'Allows guild members to teleport to the Guild Hall''s location at a significantly reduced cost.', 60, 10,
  '[
    {"item": "Yew Log", "quantity": 15000},
    {"item": "Banyan Log", "quantity": 15000},
    {"item": "Tin Bar", "quantity": 20000},
    {"item": "Lead Bar", "quantity": 15000},
    {"item": "Chromite Bar", "quantity": 10000},
    {"item": "Mystic Bar", "quantity": 15000}
  ]'::jsonb, 3),

('mission_table', 'Mission Table', 'Automatically generates challenges for the guild instead of requiring manual setup.', 25, 10,
  '[
    {"item": "Oak Log", "quantity": 7500},
    {"item": "Birch Log", "quantity": 7500},
    {"item": "Banyan Log", "quantity": 7500},
    {"item": "Willow Log", "quantity": 10000},
    {"item": "Mahogany Log", "quantity": 7500},
    {"item": "Lead Bar", "quantity": 7500},
    {"item": "Steel Bar", "quantity": 7500}
  ]'::jsonb, 4),

('raid_planner', 'Raid Planner', 'Allows guilds to schedule up to 10 raids in advance, up to a month in advance.', 40, 10,
  '[
    {"item": "Oak Log", "quantity": 5000},
    {"item": "Spruce Log", "quantity": 5000},
    {"item": "Maple Log", "quantity": 10000},
    {"item": "Mystical Log", "quantity": 12500},
    {"item": "Iron Bar", "quantity": 12500},
    {"item": "Chromite Bar", "quantity": 10000}
  ]'::jsonb, 5),

('unity_seal', 'Unity Seal', 'Allows guilds to create a custom 3-letter guild tag, displayed next to every member''s username.', 15, 10,
  '[
    {"item": "Oak Log", "quantity": 7500},
    {"item": "Birch Log", "quantity": 7500},
    {"item": "Mahogany Log", "quantity": 7500},
    {"item": "Copper Bar", "quantity": 7500},
    {"item": "Steel Bar", "quantity": 7500}
  ]'::jsonb, 6),

('energizing_pool', 'Energizing Pool', 'Provides temporary time-limited boosts to all guild members. Boosts range from 1% to 15% depending on Guild Mastery level.', 70, 15,
  '[
    {"item": "Spruce Log", "quantity": 25000},
    {"item": "Maple Log", "quantity": 25000},
    {"item": "Mystical Log", "quantity": 15000},
    {"item": "Iron Bar", "quantity": 15000},
    {"item": "Mercury Bar", "quantity": 15000},
    {"item": "Uranium Bar", "quantity": 15000}
  ]'::jsonb, 7),

('conquest_banner', 'Conquest Banner', 'Required for the guild to undertake Conquests.', 50, 10,
  '[
    {"item": "Yew Log", "quantity": 10000},
    {"item": "Maple Log", "quantity": 7500},
    {"item": "Mystical Log", "quantity": 12500},
    {"item": "Copper Bar", "quantity": 10000},
    {"item": "Steel Bar", "quantity": 10000},
    {"item": "Uranium Bar", "quantity": 10000},
    {"item": "Mystic Bar", "quantity": 7500}
  ]'::jsonb, 8)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  guild_level_required = EXCLUDED.guild_level_required,
  mark_cost = EXCLUDED.mark_cost,
  resources = EXCLUDED.resources,
  display_order = EXCLUDED.display_order;

-- Enable RLS on guild_buildings
ALTER TABLE guild_buildings ENABLE ROW LEVEL SECURITY;

-- Everyone can view buildings (public data)
DROP POLICY IF EXISTS "Buildings are public" ON guild_buildings;
CREATE POLICY "Buildings are public"
  ON guild_buildings FOR SELECT
  USING (true);

-- Add active_buildings setting to all guild configs (empty array by default)
UPDATE guild_config
SET settings = jsonb_set(
  COALESCE(settings, '{}'::jsonb),
  '{active_buildings}',
  '[]'::jsonb,
  true
)
WHERE settings IS NULL
   OR NOT settings ? 'active_buildings';

-- Verify the setup
SELECT id, name, guild_level_required, mark_cost, jsonb_array_length(resources) as resource_count
FROM guild_buildings
ORDER BY display_order;

SELECT guild_id, guild_name, settings->'active_buildings' as active_buildings
FROM guild_config
ORDER BY guild_name;

COMMENT ON TABLE guild_buildings IS 'Guild hall building types and their resource requirements';
COMMENT ON COLUMN guild_buildings.resources IS 'JSONB array of {item: string, quantity: number} for required resources';
