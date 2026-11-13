-- ============================================================================
-- Assault Conquest tracking + member checklist
-- Depends on: assault-planner.sql (assault_configs), guild_config, auth.users
-- Apply AFTER assault-planner.sql.
--
-- BEFORE APPLYING:
--   1. Replace REPLACE_WITH_APP_URL and REPLACE_WITH_CRON_SECRET at the bottom.
-- ============================================================================

-- Add tracked zone + external numeric guild id to assault_configs
ALTER TABLE assault_configs
  ADD COLUMN IF NOT EXISTS tracked_zone_id INTEGER,
  ADD COLUMN IF NOT EXISTS tracked_zone_key TEXT,
  ADD COLUMN IF NOT EXISTS external_guild_id INTEGER;

-- Static zone catalog (seeded; one-source-of-truth for zones + enemies)
CREATE TABLE IF NOT EXISTS assault_zones (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  level_min INT,
  level_max INT,
  shrine_info TEXT,
  enemies JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- enemies: [{ name, level, drops, ev_per_kill, gold_per_hr }]
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seasons (conquest seasons from IdleMMO)
CREATE TABLE IF NOT EXISTS assault_seasons (
  season_number INT PRIMARY KEY,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Individual assault runs for our tracked guilds
CREATE TABLE IF NOT EXISTS assault_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  external_guild_id INTEGER NOT NULL,
  zone_id INTEGER NOT NULL,
  zone_key TEXT NOT NULL,
  zone_name TEXT NOT NULL,
  season_number INT,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  total_kills BIGINT NOT NULL DEFAULT 0,
  total_experience BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'collecting',
    -- collecting | finalized
  snapshot_taken_at TIMESTAMPTZ,
  discord_message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (external_guild_id, zone_id, starts_at)
);

CREATE INDEX IF NOT EXISTS idx_assault_runs_guild_ends
  ON assault_runs(guild_id, ends_at DESC);
CREATE INDEX IF NOT EXISTS idx_assault_runs_status
  ON assault_runs(status);
CREATE INDEX IF NOT EXISTS idx_assault_runs_season
  ON assault_runs(season_number);

-- Per-character contribution snapshot at finalize time
CREATE TABLE IF NOT EXISTS assault_contributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES assault_runs(id) ON DELETE CASCADE,
  character_id INTEGER NOT NULL,
  character_hashed_id TEXT,
  character_name TEXT NOT NULL,
  total_level INT,
  kills BIGINT NOT NULL DEFAULT 0,
  experience BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, character_id)
);

CREATE INDEX IF NOT EXISTS idx_assault_contrib_run
  ON assault_contributions(run_id);
CREATE INDEX IF NOT EXISTS idx_assault_contrib_char
  ON assault_contributions(character_id);
CREATE INDEX IF NOT EXISTS idx_assault_contrib_name
  ON assault_contributions(LOWER(character_name));

-- Checklist item templates per guild
CREATE TABLE IF NOT EXISTS assault_checklist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  phase TEXT NOT NULL DEFAULT 'prep',
    -- prep | pre_buff | launch | mid | end
  sort_order INT NOT NULL DEFAULT 0,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (guild_id, item_key)
);

CREATE INDEX IF NOT EXISTS idx_assault_checklist_items_guild
  ON assault_checklist_items(guild_id);

-- Per-user, per-launch_date checklist state
CREATE TABLE IF NOT EXISTS assault_checklist_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  launch_date DATE NOT NULL,
  item_key TEXT NOT NULL,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source TEXT NOT NULL DEFAULT 'web',
    -- web | discord
  UNIQUE (user_id, guild_id, launch_date, item_key)
);

CREATE INDEX IF NOT EXISTS idx_assault_checklist_progress_lookup
  ON assault_checklist_progress(user_id, guild_id, launch_date);

-- ============================================================================
-- Seed: Isle of Whispers zone + full enemy catalog from leaderboard snapshot
-- ============================================================================

INSERT INTO assault_zones (id, key, name, level_min, level_max, shrine_info, enemies)
VALUES
  (1, 'bluebell-hollow', 'Bluebell Hollow', 1, 6, NULL, '[
    {"name":"Rabbit","level":1,"drops":2,"ev_per_kill":3.2,"gold_per_hr":1161},
    {"name":"Goblin","level":2,"drops":4,"ev_per_kill":5.3,"gold_per_hr":1910},
    {"name":"Duck","level":4,"drops":2,"ev_per_kill":2.6,"gold_per_hr":934},
    {"name":"Goblin King","level":6,"drops":5,"ev_per_kill":11.1,"gold_per_hr":4002}
  ]'::jsonb),
  (2, 'whispering-woods', 'Whispering Woods', 8, 16, NULL, '[
    {"name":"Boar","level":8,"drops":2,"ev_per_kill":5.7,"gold_per_hr":2036},
    {"name":"Deer","level":10,"drops":2,"ev_per_kill":2.4,"gold_per_hr":880},
    {"name":"Cultist","level":12,"drops":5,"ev_per_kill":6.4,"gold_per_hr":2299},
    {"name":"Gorgon","level":14,"drops":3,"ev_per_kill":7.1,"gold_per_hr":2543},
    {"name":"Djinn","level":16,"drops":2,"ev_per_kill":20.6,"gold_per_hr":7402}
  ]'::jsonb),
  (3, 'eldoria', 'Eldoria', 18, 28, NULL, '[
    {"name":"Spectre","level":18,"drops":2,"ev_per_kill":3.1,"gold_per_hr":1127},
    {"name":"Ogre","level":20,"drops":3,"ev_per_kill":4.6,"gold_per_hr":1666},
    {"name":"Buffalo","level":22,"drops":2,"ev_per_kill":3.2,"gold_per_hr":1144},
    {"name":"Slimeball","level":24,"drops":2,"ev_per_kill":1.5,"gold_per_hr":526},
    {"name":"Pirate","level":26,"drops":4,"ev_per_kill":10.9,"gold_per_hr":3908},
    {"name":"Skeleton Warrior","level":28,"drops":2,"ev_per_kill":4.8,"gold_per_hr":1746}
  ]'::jsonb),
  (4, 'crystal-caverns', 'Crystal Caverns', 32, 42, NULL, '[
    {"name":"Zombie","level":32,"drops":2,"ev_per_kill":1.7,"gold_per_hr":627},
    {"name":"Shadow Beast","level":35,"drops":3,"ev_per_kill":7.8,"gold_per_hr":2816},
    {"name":"Elephant","level":36,"drops":2,"ev_per_kill":4.9,"gold_per_hr":1761},
    {"name":"Elk","level":38,"drops":2,"ev_per_kill":5.6,"gold_per_hr":2032},
    {"name":"Siren","level":42,"drops":4,"ev_per_kill":6.6,"gold_per_hr":2377}
  ]'::jsonb),
  (5, 'skyreach-peak', 'Skyreach Peak', 48, 58, NULL, '[
    {"name":"Lion","level":48,"drops":2,"ev_per_kill":8.4,"gold_per_hr":3015},
    {"name":"Wraith","level":52,"drops":2,"ev_per_kill":3.6,"gold_per_hr":1312},
    {"name":"Moose","level":54,"drops":2,"ev_per_kill":4.9,"gold_per_hr":1775},
    {"name":"Golem","level":58,"drops":4,"ev_per_kill":7.9,"gold_per_hr":2836}
  ]'::jsonb),
  (6, 'enchanted-oasis', 'Enchanted Oasis', 60, 69, NULL, '[
    {"name":"Polar Bear","level":60,"drops":2,"ev_per_kill":6.1,"gold_per_hr":2183},
    {"name":"Witch","level":62,"drops":4,"ev_per_kill":10.0,"gold_per_hr":3613},
    {"name":"Raccoon","level":64,"drops":2,"ev_per_kill":5.5,"gold_per_hr":1966},
    {"name":"Dwarven Warrior","level":68,"drops":4,"ev_per_kill":7.3,"gold_per_hr":2645},
    {"name":"Wolf","level":69,"drops":2,"ev_per_kill":7.5,"gold_per_hr":2711}
  ]'::jsonb),
  (7, 'floating-gardens-of-aetheria', 'Floating Gardens of Aetheria', 70, 76, NULL, '[
    {"name":"Black Bear","level":70,"drops":2,"ev_per_kill":6.7,"gold_per_hr":2419},
    {"name":"Minotaur","level":72,"drops":3,"ev_per_kill":11.3,"gold_per_hr":4058},
    {"name":"Reaper","level":74,"drops":3,"ev_per_kill":2.9,"gold_per_hr":1044},
    {"name":"Harpy","level":76,"drops":3,"ev_per_kill":3.1,"gold_per_hr":1127}
  ]'::jsonb),
  (8, 'celestial-observatory', 'Celestial Observatory', 78, 89, NULL, '[
    {"name":"Undead Knight","level":78,"drops":4,"ev_per_kill":9.3,"gold_per_hr":3354},
    {"name":"Wizard of the South","level":82,"drops":5,"ev_per_kill":20.3,"gold_per_hr":7316},
    {"name":"Air Elemental","level":84,"drops":3,"ev_per_kill":8.4,"gold_per_hr":3038},
    {"name":"Water Elemental","level":86,"drops":3,"ev_per_kill":8.3,"gold_per_hr":2978},
    {"name":"Fire Elemental","level":89,"drops":3,"ev_per_kill":11.7,"gold_per_hr":4214}
  ]'::jsonb),
  (9, 'isle-of-whispers', 'Isle of Whispers', 92, 99, 'On-site Shrine', '[
    {"name":"Basilisk","level":92,"drops":4,"ev_per_kill":33.6,"gold_per_hr":12113},
    {"name":"Griffon","level":94,"drops":3,"ev_per_kill":3.9,"gold_per_hr":1396},
    {"name":"Earth Elemental","level":98,"drops":3,"ev_per_kill":9.3,"gold_per_hr":3331},
    {"name":"Werewolf","level":99,"drops":4,"ev_per_kill":9.3,"gold_per_hr":3349}
  ]'::jsonb),
  (10, 'the-citadel', 'The Citadel', 100, 100, NULL, '[
    {"name":"Kikimora","level":100,"drops":5,"ev_per_kill":25.8,"gold_per_hr":9302},
    {"name":"Arvendor Guardian","level":100,"drops":4,"ev_per_kill":12.8,"gold_per_hr":4618},
    {"name":"Man Moth","level":100,"drops":4,"ev_per_kill":10.9,"gold_per_hr":3938},
    {"name":"Will-o''-the-wisp","level":100,"drops":4,"ev_per_kill":9.4,"gold_per_hr":3378},
    {"name":"Banshee","level":100,"drops":4,"ev_per_kill":7.8,"gold_per_hr":2805}
  ]'::jsonb)
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  level_min = EXCLUDED.level_min,
  level_max = EXCLUDED.level_max,
  shrine_info = EXCLUDED.shrine_info,
  enemies = EXCLUDED.enemies,
  updated_at = NOW();

-- Default: point existing assault_configs with zone_name = Isle of Whispers at that zone
UPDATE assault_configs
SET tracked_zone_id = 9, tracked_zone_key = 'isle-of-whispers'
WHERE tracked_zone_id IS NULL
  AND LOWER(zone_name) LIKE '%isle of whispers%';

-- Backfill external_guild_id from guild_config.guild_id when it's numeric
UPDATE assault_configs ac
SET external_guild_id = (gc.guild_id)::INTEGER
FROM guild_config gc
WHERE ac.guild_id = gc.guild_id
  AND ac.external_guild_id IS NULL
  AND gc.guild_id ~ '^[0-9]+$';

-- ============================================================================
-- Seed default checklist items for every guild with an assault_config
-- ============================================================================

INSERT INTO assault_checklist_items (guild_id, item_key, label, description, phase, sort_order)
SELECT ac.guild_id, v.item_key, v.label, v.description, v.phase, v.sort_order
FROM assault_configs ac
CROSS JOIN (VALUES
  ('pool_live',       'Pool live (2h window)',       'Guild Energizing Pool activated',                   'prep',     10),
  ('mobs_stocked',    'Hunting stocked 4k–10k+',     '+10–20% flee buffer; Lvl 92+ pet for Isle',         'prep',     20),
  ('inventory_clear', 'Inventory cleared',           'Dump junk, pack food',                              'prep',     30),
  ('combat_gear',     'Combat gear equipped',        'Remove hunting bows',                               'prep',     40),
  ('battle_pet',      'Battle pet equipped + patted','Highest Attack/Protection',                         'prep',     50),
  ('perks_active',    'Ascension perks active',      NULL,                                                'prep',     60),
  ('shrine_active',   'Shrine activated',            NULL,                                                'prep',     70),
  ('xp_pots_staged',  'Combat XP + Battle XP pots staged', 'Do NOT drink POTG yet',                       'prep',     80),
  ('wraithbane',      'Wraithbane / Strike Essence', NULL,                                                'pre_buff', 90),
  ('combat_pot',      'Combat stat potion',          'Thunderfury / Bladeburst',                          'pre_buff', 100),
  ('potg_ready',      'POTG in hand',                NULL,                                                'pre_buff', 110),
  ('launched',        'POTG chugged + Battle clicked','Up to 6 mobs, lowest hits-to-kill',                'launch',   120),
  ('restack_30m',     '+30m restack + stat pots',    'Only if didn''t start with one active',             'mid',      130),
  ('final_restack',   '+50m 8h restack locked in',   'Finish current fight, restack while POTG/Pool up', 'end',      140)
) AS v(item_key, label, description, phase, sort_order)
ON CONFLICT (guild_id, item_key) DO NOTHING;

-- ============================================================================
-- Collector cron: every 5 minutes, poll conquest + finalize completed runs
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'assault-collector-tick') THEN
    PERFORM cron.unschedule('assault-collector-tick');
  END IF;
END $$;

SELECT cron.schedule(
  'assault-collector-tick',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'REPLACE_WITH_APP_URL/api/cron/assault-collector',
    headers := jsonb_build_object(
      'Authorization', 'Bearer REPLACE_WITH_CRON_SECRET',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
