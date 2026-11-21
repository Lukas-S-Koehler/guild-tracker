-- Stat sync steps: scheduler pulls conquest contributions and posts a stats embed
-- at launch +13h (interim) and +25h (final). The message_template is unused for these.
WITH steps(step_key, label, offset_minutes, sort_order, message_template) AS (
  VALUES
    ('sync_13h', 'Stat sync + post (13h)', 780, 900, '(stat sync - no template)'),
    ('sync_25h', 'Stat sync + final post (25h)', 1500, 910, '(stat sync - no template)')
)
INSERT INTO assault_ping_steps (guild_id, step_key, label, offset_minutes, sort_order, message_template)
SELECT c.guild_id, s.step_key, s.label, s.offset_minutes, s.sort_order, s.message_template
FROM assault_configs c CROSS JOIN steps s
ON CONFLICT (guild_id, step_key) DO NOTHING;
