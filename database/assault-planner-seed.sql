-- ============================================================================
-- Assault Planner seed: default configs + ping timeline for every guild_config row
-- Idempotent — safe to rerun.
-- ============================================================================

-- 1) One assault_configs row per existing guild_config (inactive by default)
INSERT INTO assault_configs (guild_id, enemy_priority)
SELECT
  gc.guild_id,
  '[
    {"name":"Basilisk","level":92,"gold_per_hr":12113},
    {"name":"Werewolf","level":99,"gold_per_hr":3349},
    {"name":"Earth Elemental","level":98,"gold_per_hr":3331},
    {"name":"Griffon","level":94,"gold_per_hr":1396}
  ]'::jsonb
FROM guild_config gc
ON CONFLICT (guild_id) DO NOTHING;

-- 2) Default ping steps per guild. ON CONFLICT (guild_id, step_key) keeps edits intact.
WITH guilds AS (SELECT guild_id FROM guild_config),
steps(step_key, label, offset_minutes, sort_order, message_template) AS (
  VALUES
    ('warn_120', '2h Warning — Pool & Hunting', -120, 10,
$msg$ {{member_role}} **2h Warning — Pool & Hunting**
Pool live for 2h (1h final hunting + 1h overlap for assault launch & 8h stack refresh).
Farm **{{target_mob_count}}** of {{zone_name}} (Lvl {{level_range}}). Lvl 92+ pet needed.
Launch: {{launch_timestamp}} ({{launch_relative}}). $msg$),

    ('warn_30', '30m Warning', -30, 20,
$msg$ {{member_role}} **30m Warning**
Wrap hunting. Clear inventory. Pack food. Confirm combat stance.
Launch: {{launch_timestamp}} ({{launch_relative}}). $msg$),

    ('prep_10', '10m Prep (The 5 Ps)', -10, 30,
$msg$ {{member_role}} **10m Prep — The 5 Ps for {{zone_name}}**
1. Equip **Combat Gear** (remove hunting bows)
2. Equip & pat **Battle Pet** (highest Attack/Protection)
3. Activate **Ascension Perks**
4. Activate **Pool**
5. Activate **Shrine** — {{shrine_info}}

Stage **Combat XP + Battle XP + Battle Stat** potions. **DO NOT drink POTG yet.**
Kill order: {{mob_order}}
Launch: {{launch_timestamp}} ({{launch_relative}}). $msg$),

    ('prebuff_5', '5m Pre-Buff', -5, 40,
$msg$ {{member_role}} **5m Pre-Buff**
Drink **Wraithbane** (or Strike Essence) + **Combat Stat potion** (Thunderfury / Bladeburst).
Stage **POTG** in hand. Launch in {{launch_relative}}. $msg$),

    ('launch_0', 'GO TIME', 0, 50,
$msg$ {{member_role}} **🚀 GO TIME — {{zone_name}}**
Chug **POTG**. Select up to **6 mobs** (keep hits-to-kill as low as possible!). Click **Battle!**
Kill order: {{mob_order}}
Next ping: 30m. Final restack: 50m. $msg$),

    ('refresh_30', '30m Refresh', 30, 60,
$msg$ {{member_role}} **30m Refresh**
Chug **Combat Stat** potions. Restack mobs if you didn't start with one active. $msg$),

    ('final_50', 'Final Call — 8h Lock-In', 50, 70,
$msg$ {{member_role}} **⏰ Final Call — 8h Lock-In**
Cancel/finish current fight. **Restack a full 8h of mobs NOW** while POTG + Pool buffs are still active.
Do NOT risk min-maxing an extra kill and losing the POTG snapshot.
Double-check gear, pet, shrine, perks, food. Don't become a Petroleum Engineer. $msg$)
)
INSERT INTO assault_ping_steps (guild_id, step_key, label, offset_minutes, sort_order, message_template)
SELECT g.guild_id, s.step_key, s.label, s.offset_minutes, s.sort_order, s.message_template
FROM guilds g CROSS JOIN steps s
ON CONFLICT (guild_id, step_key) DO NOTHING;
