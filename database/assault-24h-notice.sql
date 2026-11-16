-- 24h-before-assault notice. Scheduler fires steps at launch + offset_minutes,
-- including offsets that land on the previous UTC day.
WITH steps(step_key, label, offset_minutes, sort_order, message_template) AS (
  VALUES (
    'notice_24h', '24h Notice — Get Your Mobs', -1440, 5,
$msg${{member_role}} **Assault starts in 24 hours!** Make sure to get enough mobs!
Launch: {{launch_timestamp}} ({{launch_relative}}). Zone: {{zone_name}} (Lvl {{level_range}}).$msg$
  )
)
INSERT INTO assault_ping_steps (guild_id, step_key, label, offset_minutes, sort_order, message_template)
SELECT c.guild_id, s.step_key, s.label, s.offset_minutes, s.sort_order, s.message_template
FROM assault_configs c CROSS JOIN steps s
ON CONFLICT (guild_id, step_key) DO NOTHING;
