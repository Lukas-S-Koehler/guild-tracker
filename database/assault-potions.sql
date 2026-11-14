-- ============================================================================
-- Assault Potions: catalog, presets, per-user loadouts
-- Depends on: auth.users
-- ============================================================================

-- Combat-stat potions (attack / protection / combo)
CREATE TABLE IF NOT EXISTS combat_potions (
  id INT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  quality TEXT NOT NULL CHECK (quality IN ('PREMIUM','EPIC','LEGENDARY','MYTHIC')),
  is_tradeable BOOLEAN NOT NULL DEFAULT TRUE,
  attack_power_bonus INT NOT NULL DEFAULT 0,
  protection_bonus INT NOT NULL DEFAULT 0,
  vendor_price INT NOT NULL DEFAULT 0,
  market_price INT,
  avg_recent_sales TEXT,
  hashed_item_id TEXT,
  image_url TEXT,
  duration_minutes INT,
  last_price_sync TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- XP potions: battle_xp and combat_xp
CREATE TABLE IF NOT EXISTS xp_potions (
  id INT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL CHECK (category IN ('combat_xp','battle_xp')),
  quality TEXT CHECK (quality IN ('PREMIUM','EPIC','LEGENDARY','MYTHIC')),
  type TEXT,
  effect_value INT NOT NULL DEFAULT 0,
  target TEXT,
  xp_value INT NOT NULL DEFAULT 0,
  efficiency_value INT NOT NULL DEFAULT 0,
  stacks BOOLEAN NOT NULL DEFAULT FALSE,
  market_price INT,
  avg_recent_sales TEXT,
  image_url TEXT,
  hashed_item_id TEXT,
  duration_minutes INT,
  is_free_common BOOLEAN NOT NULL DEFAULT FALSE,
  description TEXT,
  last_price_sync TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Preset tiers (free / budget / mid / whale)
CREATE TABLE IF NOT EXISTS assault_potion_presets (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  combat_potion_ids INT[] NOT NULL DEFAULT '{}',
  xp_potion_ids INT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Per-user saved loadouts
CREATE TABLE IF NOT EXISTS assault_potion_loadouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  combat_potion_ids INT[] NOT NULL DEFAULT '{}',
  xp_potion_ids INT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assault_loadouts_user
  ON assault_potion_loadouts(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_assault_loadouts_default
  ON assault_potion_loadouts(user_id) WHERE is_default;

-- RLS
ALTER TABLE combat_potions ENABLE ROW LEVEL SECURITY;
ALTER TABLE xp_potions ENABLE ROW LEVEL SECURITY;
ALTER TABLE assault_potion_presets ENABLE ROW LEVEL SECURITY;
ALTER TABLE assault_potion_loadouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "combat_potions_read_all" ON combat_potions;
CREATE POLICY "combat_potions_read_all" ON combat_potions FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "xp_potions_read_all" ON xp_potions;
CREATE POLICY "xp_potions_read_all" ON xp_potions FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "assault_potion_presets_read_all" ON assault_potion_presets;
CREATE POLICY "assault_potion_presets_read_all" ON assault_potion_presets FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "assault_loadouts_user_select" ON assault_potion_loadouts;
CREATE POLICY "assault_loadouts_user_select" ON assault_potion_loadouts
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "assault_loadouts_user_insert" ON assault_potion_loadouts;
CREATE POLICY "assault_loadouts_user_insert" ON assault_potion_loadouts
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "assault_loadouts_user_update" ON assault_potion_loadouts;
CREATE POLICY "assault_loadouts_user_update" ON assault_potion_loadouts
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "assault_loadouts_user_delete" ON assault_potion_loadouts;
CREATE POLICY "assault_loadouts_user_delete" ON assault_potion_loadouts
  FOR DELETE USING (auth.uid() = user_id);

-- ============================================================================
-- Seed: combat_potions (14 rows)
-- ============================================================================
INSERT INTO combat_potions (id, name, quality, is_tradeable, attack_power_bonus, protection_bonus, vendor_price, market_price, avg_recent_sales, hashed_item_id, image_url, last_price_sync) VALUES
(1, 'Attack Power Potion', 'PREMIUM', TRUE, 5, 0, 250, 395, '395', 'oZwey82VNAA6ND0dXM3g', 'https://cdn.idle-mmo.com/uploaded/skins/HWSyxMdMRcNhTDLzN4FljAv79YxxDE-metac3Ryb25nLWV4cDEucG5n-.png', '2026-05-15 15:07:33.557+00'),
(3, 'Protection Potion', 'PREMIUM', TRUE, 0, 5, 250, 384, '384', 'oaJydnOmQWW2QbgRe5ME', 'https://cdn.idle-mmo.com/uploaded/skins/HWSyxMdMRcNhTDLzN4FljAv79YxxDE-metac3Ryb25nLWV4cDEucG5n-.png', '2026-05-15 15:07:33.923+00'),
(5, 'Bladeburst Elixir', 'EPIC', TRUE, 10, 0, 500, 1750, '1750', 'XjEaOeBkLa7MNlGwxVPq', 'https://cdn.idle-mmo.com/uploaded/skins/gASZ22DnKwtl982ruPHBZCHP3sovHF-metac3Ryb25nLWx1Y2syLnBuZw==-.png', '2026-05-15 15:07:29.928+00'),
(7, 'Bulwark Brew', 'EPIC', TRUE, 0, 10, 500, 837, '837', 'BPjze3x2Q3ygYR85vgZV', 'https://cdn.idle-mmo.com/uploaded/skins/gASZ22DnKwtl982ruPHBZCHP3sovHF-metac3Ryb25nLWx1Y2syLnBuZw==-.png', '2026-05-15 15:07:30.419+00'),
(8, 'Cosmic Tear', 'LEGENDARY', TRUE, 10, 20, 2500, 3774, '3774', '27gw0k38L4ZxNWevJxyK', 'https://cdn.idle-mmo.com/uploaded/skins/gASZ22DnKwtl982ruPHBZCHP3sovHF-metac3Ryb25nLWx1Y2syLnBuZw==-.png', '2026-05-15 15:07:30.821+00'),
(9, 'Frenzy Potion', 'LEGENDARY', TRUE, 15, 0, 2500, 3220, '3220', 'brz9RZnWN7VaQKAp0Mdl', 'https://cdn.idle-mmo.com/uploaded/skins/gASZ22DnKwtl982ruPHBZCHP3sovHF-metac3Ryb25nLWx1Y2syLnBuZw==-.png', '2026-05-15 15:07:31.355+00'),
(10, 'Shieldbearer''s Infusion', 'LEGENDARY', TRUE, 0, 15, 2500, 3290, '3290', 'dgBq1boWYeB0LkJ3rXaD', 'https://cdn.idle-mmo.com/uploaded/skins/gASZ22DnKwtl982ruPHBZCHP3sovHF-metac3Ryb25nLWx1Y2syLnBuZw==-.png', '2026-05-15 15:07:31.727+00'),
(11, 'Thunderfury Brew', 'LEGENDARY', TRUE, 20, 10, 2500, 5940, '5940', 'Z6aDoyRnLybkQpV5AGXm', 'https://cdn.idle-mmo.com/uploaded/skins/gASZ22DnKwtl982ruPHBZCHP3sovHF-metac3Ryb25nLWx1Y2syLnBuZw==-.png', '2026-05-15 15:07:32.115+00'),
(12, 'Dragon''s Essence', 'MYTHIC', TRUE, 50, 0, 20000, 100000, '100000', 'zvjoJW96Y8j5Q3RaAylw', 'https://cdn.idle-mmo.com/uploaded/skins/PtdKmZd48p2qP84VIS9rhKTfT9itjU-metac3Ryb25nLXNwZWVkMi5wbmc=-.png', '2026-05-15 15:07:32.46+00'),
(13, 'Guardian''s Soul', 'MYTHIC', TRUE, 0, 50, 20000, 70079, '70079', 'oZwey82VNAg6LD0dXM3g', 'https://cdn.idle-mmo.com/uploaded/skins/PtdKmZd48p2qP84VIS9rhKTfT9itjU-metac3Ryb25nLXNwZWVkMi5wbmc=-.png', '2026-05-15 15:07:32.812+00'),
(14, 'Phoenix Ashes', 'MYTHIC', TRUE, 25, 25, 20000, 87300, '87300', 'JZdg5V3PQoqKYEyWq0zl', 'https://cdn.idle-mmo.com/uploaded/skins/PtdKmZd48p2qP84VIS9rhKTfT9itjU-metac3Ryb25nLXNwZWVkMi5wbmc=-.png', '2026-05-15 15:07:33.188+00')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  quality = EXCLUDED.quality,
  is_tradeable = EXCLUDED.is_tradeable,
  attack_power_bonus = EXCLUDED.attack_power_bonus,
  protection_bonus = EXCLUDED.protection_bonus,
  vendor_price = EXCLUDED.vendor_price,
  updated_at = NOW();

-- ============================================================================
-- Seed: xp_potions
-- Combat XP: Sun's Light, Wraithbane Essence, Dungeon Master's Tonic, Dungeon Potion
-- (skip Fallen Star — doesn't stack / unusable here)
-- Battle XP: POTG, Dragonblood Tonic, Vortex Brew, Battle Potion, Strike Essence
-- ============================================================================
INSERT INTO xp_potions (id, name, category, quality, type, effect_value, target, xp_value, efficiency_value, stacks, market_price, avg_recent_sales, image_url, hashed_item_id, is_free_common, description) VALUES
-- Combat XP
(101, 'Sun''s Light', 'combat_xp', 'MYTHIC', 'xp', 100, 'dungeon', 100, 0, FALSE, 196542, '196542', 'https://cdn.idle-mmo.com/uploaded/skins/PtdKmZd48p2qP84VIS9rhKTfT9itjU-metac3Ryb25nLXNwZWVkMi5wbmc=-.png', 'jGXBy7a4LbBML0Pw6Vdg', FALSE, NULL),
(103, 'Wraithbane Essence', 'combat_xp', 'LEGENDARY', 'efficiency', 20, 'dungeon', 40, 20, FALSE, 7990, '7990', 'https://cdn.idle-mmo.com/uploaded/skins/gASZ22DnKwtl982ruPHBZCHP3sovHF-metac3Ryb25nLWx1Y2syLnBuZw==-.png', 'P1vlVrzjLryRYao8mGKM', FALSE, NULL),
(104, 'Dungeon Master''s Tonic', 'combat_xp', 'EPIC', 'xp', 25, 'dungeon', 25, 10, FALSE, 2499, '2499', 'https://cdn.idle-mmo.com/uploaded/skins/gASZ22DnKwtl982ruPHBZCHP3sovHF-metac3Ryb25nLWx1Y2syLnBuZw==-.png', 'j98bO5w1QP0jQ3xkREVJ', FALSE, NULL),
(105, 'Dungeon Potion', 'combat_xp', 'PREMIUM', 'efficiency', 5, 'dungeon', 15, 5, FALSE, 849, '849', 'https://cdn.idle-mmo.com/uploaded/skins/mqplcNi12qglIBOu2FPOXLRtX99VgK-metabW9kZXJhdGUtZXhwMi5wbmc=-.png', '27gw0k38L44xLWevJxyK', FALSE, NULL),
-- Battle XP (ids 200+) — market data populated by sync cron; seeds have NULL prices
(200, 'Potion of the Gods', 'battle_xp', 'MYTHIC', 'xp', 100, 'battle', 100, 0, FALSE, NULL, NULL, NULL, NULL, TRUE, 'Often awarded free from campaign & daily rewards.'),
(201, 'Dragonblood Tonic', 'battle_xp', 'LEGENDARY', 'xp', 50, 'battle', 50, 0, FALSE, NULL, NULL, NULL, NULL, FALSE, NULL),
(202, 'Vortex Brew', 'battle_xp', 'EPIC', 'xp', 25, 'battle', 25, 0, FALSE, NULL, NULL, NULL, NULL, FALSE, NULL),
(203, 'Battle Potion', 'battle_xp', 'PREMIUM', 'xp', 10, 'battle', 10, 0, FALSE, NULL, NULL, NULL, NULL, FALSE, NULL),
(204, 'Strike Essence', 'battle_xp', 'EPIC', 'efficiency', 20, 'battle', 40, 20, FALSE, NULL, NULL, NULL, NULL, FALSE, NULL)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  quality = EXCLUDED.quality,
  type = EXCLUDED.type,
  effect_value = EXCLUDED.effect_value,
  target = EXCLUDED.target,
  xp_value = EXCLUDED.xp_value,
  efficiency_value = EXCLUDED.efficiency_value,
  is_free_common = EXCLUDED.is_free_common,
  description = EXCLUDED.description,
  updated_at = NOW();

-- ============================================================================
-- Seed: preset tiers
-- ============================================================================
INSERT INTO assault_potion_presets (id, label, description, sort_order, combat_potion_ids, xp_potion_ids) VALUES
('free', 'Free / F2P',
  'Zero gold path. Dungeon Potion + tradeable combat freebies. Swap in POTG when you have one.',
  1,
  ARRAY[5, 7]::INT[],
  ARRAY[204, 105]::INT[]),
('budget', 'Budget',
  'Mid-market stack. Skip Battle XP mythic; use Strike Essence + Wraithbane.',
  2,
  ARRAY[11]::INT[],
  ARRAY[204, 103]::INT[]),
('mid', 'Mid',
  'POTG + proven combo. Balanced cost & output.',
  3,
  ARRAY[11]::INT[],
  ARRAY[200, 103]::INT[]),
('whale', 'Whale',
  'Burn gold. Dragon''s Essence + Guardian''s Soul + Sun''s Light + POTG.',
  4,
  ARRAY[12, 13]::INT[],
  ARRAY[200, 101]::INT[])
ON CONFLICT (id) DO UPDATE SET
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  sort_order = EXCLUDED.sort_order,
  combat_potion_ids = EXCLUDED.combat_potion_ids,
  xp_potion_ids = EXCLUDED.xp_potion_ids,
  updated_at = NOW();
