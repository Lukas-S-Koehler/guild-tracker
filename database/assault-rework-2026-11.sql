-- ============================================================================
-- Assault rework (2026-11-14)
-- - Personal (Discord-first) checklist with global template
-- - Nullable user_id on loadouts (Discord-only loadouts allowed)
-- - weekdays + season on assault_configs (not daily anymore)
-- - computeActivationMinutes handled in code (reads duration_minutes)
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Loadouts: Discord-first (user_id becomes nullable)
-- ---------------------------------------------------------------------------
ALTER TABLE assault_potion_loadouts
  ALTER COLUMN user_id DROP NOT NULL;

-- Must have at least one owner
ALTER TABLE assault_potion_loadouts
  DROP CONSTRAINT IF EXISTS assault_potion_loadouts_owner_chk;
ALTER TABLE assault_potion_loadouts
  ADD CONSTRAINT assault_potion_loadouts_owner_chk
  CHECK (user_id IS NOT NULL OR discord_user_id IS NOT NULL);

-- One default per Discord user (separate from existing per-user default index)
DROP INDEX IF EXISTS idx_assault_loadouts_default_discord;
CREATE UNIQUE INDEX idx_assault_loadouts_default_discord
  ON assault_potion_loadouts(discord_user_id)
  WHERE is_default AND discord_user_id IS NOT NULL;

-- RLS: allow admin-client writes for Discord loadouts (existing policies tie to auth.uid).
-- Keep existing per-user policies; service role (admin client) bypasses RLS.

-- ---------------------------------------------------------------------------
-- 2. Schedule: weekdays + season window on assault_configs
-- ---------------------------------------------------------------------------
ALTER TABLE assault_configs
  ADD COLUMN IF NOT EXISTS weekdays INT[],                -- 0=Sun..6=Sat; NULL = unset (admin must configure)
  ADD COLUMN IF NOT EXISTS season_start DATE,
  ADD COLUMN IF NOT EXISTS season_end DATE;

-- ---------------------------------------------------------------------------
-- 3. Global checklist template (replaces per-guild assault_checklist_items)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS assault_checklist_template (
  item_key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT,
  phase TEXT NOT NULL DEFAULT 'prep',
    -- prep | pre_buff | launch | mid | end
  sort_order INT NOT NULL DEFAULT 0,
  anchor_minutes INT,     -- fixed offset from launch for non-potion steps; NULL = no absolute time
  potion_slot TEXT,       -- NULL | 'combat_combined' | 'combat_xp' | 'battle_xp' -- marker row replaced at render time
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE assault_checklist_template ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "assault_checklist_template_read_all" ON assault_checklist_template;
CREATE POLICY "assault_checklist_template_read_all"
  ON assault_checklist_template FOR SELECT USING (TRUE);

-- Seed template (chronological, generic prep sequence; potion slots computed per user loadout)
INSERT INTO assault_checklist_template (item_key, label, description, phase, sort_order, anchor_minutes, potion_slot) VALUES
  ('pool_live',          'Pool live (2h window)',              'Guild Energizing Pool activated',               'prep',     10, -120, NULL),
  ('mobs_stocked',       'Hunting stocked 4k–10k+',            '+10–20% flee buffer; appropriate-level pet',    'prep',     20, -60,  NULL),
  ('inventory_clear',    'Inventory cleared',                  'Dump junk, pack food',                          'prep',     30, -60,  NULL),
  ('combat_gear',        'Combat gear equipped',               'Remove hunting bows',                           'prep',     40, -60,  NULL),
  ('battle_pet',         'Battle pet equipped + patted',       'Highest Attack/Protection',                     'prep',     50, -60,  NULL),
  ('perks_active',       'Ascension perks active',             NULL,                                            'prep',     60, -45,  NULL),
  ('shrine_active',      'Shrine activated',                   NULL,                                            'prep',     70, -30,  NULL),
  ('combat_combined',    'Combat buffs (Attack+Protection)',   'Activate combined combat potion',               'pre_buff', 80, NULL, 'combat_combined'),
  ('combat_xp_potion',   'Combat XP potion',                   'Timed for +1h full-buff window',                'pre_buff', 90, NULL, 'combat_xp'),
  ('battle_xp_potion',   'Battle XP potion',                   'Timed for +1h full-buff window',                'pre_buff', 100, NULL, 'battle_xp'),
  ('launched',           'Battle clicked (go!)',               'Up to 6 mobs, lowest hits-to-kill',             'launch',   110, 0,    NULL),
  ('tag_check',          'Tag-check 5 min in',                 'Confirm kills registering',                     'mid',      120, 5,    NULL),
  ('final_refresh',      '+1h final full-buff refresh',        'All buffs active for 8h push',                  'mid',      130, 60,   NULL),
  ('post_assault',       'Post-assault wrap',                  'Log kills, shard count, feedback',              'end',      140, 480,  NULL)
ON CONFLICT (item_key) DO UPDATE SET
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  phase = EXCLUDED.phase,
  sort_order = EXCLUDED.sort_order,
  anchor_minutes = EXCLUDED.anchor_minutes,
  potion_slot = EXCLUDED.potion_slot,
  updated_at = NOW();

-- ---------------------------------------------------------------------------
-- 4. Checklist state: drop guild_id, drop launch_date from PK (personal + session)
--    New PK: (discord_user_id, launch_date, item_key) — launch_date derived
--    from user's inferred guild at render time.
-- ---------------------------------------------------------------------------
ALTER TABLE assault_checklist_discord_state
  DROP CONSTRAINT IF EXISTS assault_checklist_discord_state_pkey;
ALTER TABLE assault_checklist_discord_state
  DROP CONSTRAINT IF EXISTS assault_checklist_discord_state_guild_id_fkey;
ALTER TABLE assault_checklist_discord_state
  ALTER COLUMN guild_id DROP NOT NULL;
ALTER TABLE assault_checklist_discord_state
  ADD CONSTRAINT assault_checklist_discord_state_pkey
  PRIMARY KEY (discord_user_id, launch_date, item_key);

DROP INDEX IF EXISTS idx_assault_checklist_discord_lookup;
CREATE INDEX idx_assault_checklist_discord_lookup
  ON assault_checklist_discord_state(discord_user_id, launch_date);

COMMIT;
