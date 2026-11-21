-- World locations (images, descriptions, 5-day weather forecast) from GET /v1/world/locations/list.
CREATE TABLE IF NOT EXISTS world_locations (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  x INTEGER,
  y INTEGER,
  forecast JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
