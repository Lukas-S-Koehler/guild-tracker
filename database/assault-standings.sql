-- Conquest standings (every guild per zone per season) + per-member season contributions
-- for our tracked assault guilds. Populated by the collector (current season, hourly)
-- and by /api/admin/assault-backfill (historic seasons).

CREATE TABLE IF NOT EXISTS assault_zone_standings (
  season_number INT NOT NULL,
  zone_id INT NOT NULL,
  zone_name TEXT NOT NULL,
  external_guild_id INT NOT NULL,
  guild_name TEXT NOT NULL,
  guild_tag TEXT,
  position INT NOT NULL,
  zone_guild_count INT NOT NULL DEFAULT 0,
  kills BIGINT NOT NULL DEFAULT 0,
  experience BIGINT NOT NULL DEFAULT 0,
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (season_number, zone_id, external_guild_id)
);
CREATE INDEX IF NOT EXISTS idx_zone_standings_guild ON assault_zone_standings (external_guild_id);

CREATE TABLE IF NOT EXISTS assault_season_contributions (
  season_number INT NOT NULL,
  zone_id INT NOT NULL,
  external_guild_id INT NOT NULL,
  character_id INT NOT NULL,
  character_hashed_id TEXT,
  character_name TEXT NOT NULL,
  total_level INT,
  kills BIGINT NOT NULL DEFAULT 0,
  experience BIGINT NOT NULL DEFAULT 0,
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (season_number, zone_id, external_guild_id, character_id)
);
CREATE INDEX IF NOT EXISTS idx_season_contrib_char ON assault_season_contributions (character_id);

-- Current season marker: highest season with ended_at NULL
INSERT INTO assault_seasons (season_number) VALUES (13) ON CONFLICT (season_number) DO NOTHING;
