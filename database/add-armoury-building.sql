-- Add Armoury to guild_buildings table
INSERT INTO guild_buildings (id, name, description, guild_level_required, mark_cost, resources, display_order) VALUES
('armoury', 'Armoury', 'Allows guilds to craft and stockpile items that provide temporary boosts to members.', 60, 10,
  '[
    {"item": "Birch Log", "quantity": 10000},
    {"item": "Willow Log", "quantity": 10000},
    {"item": "Mystical Log", "quantity": 12500},
    {"item": "Copper Bar", "quantity": 10000},
    {"item": "Mercury Bar", "quantity": 10000},
    {"item": "Uranium Bar", "quantity": 10000},
    {"item": "Mystic Bar", "quantity": 7500}
  ]'::jsonb, 9)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  guild_level_required = EXCLUDED.guild_level_required,
  mark_cost = EXCLUDED.mark_cost,
  resources = EXCLUDED.resources,
  display_order = EXCLUDED.display_order;
