-- Recruiting tracker: who staff have messaged in game, so nobody double-messages a player.
-- Shared across all Dream guilds; read/written only through the API (service role),
-- gated to deputies, leaders and the super admin.
-- Run manually in the Supabase SQL editor.

CREATE TABLE IF NOT EXISTS recruit_prospects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ign TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('messaged', 'replied', 'joined', 'declined', 'skip_guild', 'skip_weak')),
  location TEXT,
  language TEXT,                 -- 'en' | 'de' | null: which message template was sent
  note TEXT,
  messaged_at TIMESTAMPTZ,
  replied_at TIMESTAMPTZ,
  joined_at TIMESTAMPTZ,
  joined_guild_id TEXT,          -- guilds.id the prospect showed up in
  recheck_after TIMESTAMPTZ,     -- skip_guild / skip_weak expire, after this they show as "to check" again
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by_name TEXT,          -- staff character name at the time of the action
  messaged_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  messaged_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_recruit_prospects_ign ON recruit_prospects (LOWER(ign));
CREATE INDEX IF NOT EXISTS idx_recruit_prospects_status ON recruit_prospects (status);

ALTER TABLE recruit_prospects ENABLE ROW LEVEL SECURITY;
-- No policies: only the service role (API) touches this table.

-- Seed from the in-game inbox as of 2026-11-24 (Floating Gardens campaign).
-- Joins are detected automatically from the member sync, so nothing is marked joined here.
INSERT INTO recruit_prospects (ign, status, location, language, note, messaged_at, replied_at, recheck_after) VALUES
  ('Jackhammer',     'messaged', 'Floating Gardens', 'en', NULL, '2026-11-24 12:00+00', NULL, NULL),
  ('Peenor',         'messaged', 'Floating Gardens', 'en', NULL, '2026-11-24 12:00+00', NULL, NULL),
  ('Coaline',        'messaged', 'Floating Gardens', 'en', NULL, '2026-11-24 12:00+00', NULL, NULL),
  ('NiCiO',          'messaged', 'Floating Gardens', 'en', NULL, '2026-11-22 12:00+00', NULL, NULL),
  ('Koltaro',        'messaged', 'Floating Gardens', 'en', NULL, '2026-11-22 12:00+00', NULL, NULL),
  ('Miner40k',       'messaged', 'Floating Gardens', 'en', NULL, '2026-11-22 12:00+00', NULL, NULL),
  ('ShadowLove',     'messaged', 'Floating Gardens', 'en', NULL, '2026-11-22 12:00+00', NULL, NULL),
  ('LitteAlchemist', 'messaged', 'Floating Gardens', 'de', NULL, '2026-11-22 12:00+00', NULL, NULL),
  ('Kombotant',      'messaged', 'Floating Gardens', 'en', NULL, '2026-11-22 12:00+00', NULL, NULL),
  ('Xuquinouers',    'messaged', 'Floating Gardens', 'en', NULL, '2026-11-22 12:00+00', NULL, NULL),
  ('Revis',          'replied',  'Floating Gardens', 'en', NULL, '2026-11-22 12:00+00', '2026-11-22 12:00+00', NULL),
  ('Asheara',        'replied',  'Floating Gardens', 'en', NULL, '2026-11-22 12:00+00', '2026-11-23 12:00+00', NULL),
  ('Maxtermind',     'replied',  'Floating Gardens', 'en', NULL, '2026-11-22 12:00+00', '2026-11-23 12:00+00', NULL),
  ('Kippax',         'declined', 'Floating Gardens', 'en', 'Has a guild, was waiting out the 24h cooldown to move', '2026-11-22 12:00+00', '2026-11-22 12:00+00', NULL)
ON CONFLICT DO NOTHING;
