-- Combat enemies cache for assault plan command.
-- Synced daily from IdleMMO GET /v1/combat/enemies/list.

CREATE TABLE IF NOT EXISTS combat_enemies (
  id             INTEGER PRIMARY KEY,
  name           TEXT NOT NULL,
  level          INTEGER NOT NULL,
  zone_id        INTEGER NOT NULL,
  zone_name      TEXT NOT NULL,
  health         INTEGER NOT NULL,
  experience     INTEGER NOT NULL,
  chance_of_loot NUMERIC NOT NULL,
  image_url      TEXT,
  loot           JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_combat_enemies_zone ON combat_enemies(zone_name);
CREATE INDEX IF NOT EXISTS idx_combat_enemies_level ON combat_enemies(level);
