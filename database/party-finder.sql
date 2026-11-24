-- ============================================================================
-- Dream Hub step 16 (F4): league party finder. Spec: docs/party-finder.md
--
-- * leagues        : in-game leagues, imported by staff pasting the league list (/league import).
--                    Restriction (cursed / restricted / forsaken / banished = only those characters)
--                    is not in the paste, staff set it with /league restrict.
-- * parties        : persistent in-game parties, each tied to one #league-party-find forum thread.
-- * party_members  : Discord users in a party (max 4, ranks mirror the game). No website account needed.
-- * party_leagues  : leagues a party plans to join or has joined.
-- * party_seekers  : solo players looking for a party (/lfg), expire after 14 days.
-- Everything is keyed by Discord user id: the feature works without a website account.
-- Safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS leagues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  skill TEXT NOT NULL,
  contribution TEXT NOT NULL CHECK (contribution IN ('exp', 'kills')),
  max_size INT NOT NULL DEFAULT 4,
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  restriction TEXT CHECK (restriction IN ('cursed', 'restricted', 'forsaken', 'banished')),
  entrants INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_leagues_dates ON leagues(ends_on, starts_on);

CREATE TABLE IF NOT EXISTS parties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  thread_id TEXT UNIQUE,
  card_message_id TEXT,
  leader_discord_id TEXT NOT NULL,
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  slayer BOOLEAN NOT NULL DEFAULT FALSE,
  note TEXT CHECK (note IS NULL OR char_length(note) <= 200),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_parties_open ON parties(closed_at);

CREATE TABLE IF NOT EXISTS party_members (
  party_id UUID NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  discord_id TEXT NOT NULL,
  rank TEXT NOT NULL DEFAULT 'member' CHECK (rank IN ('leader', 'officer', 'member')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (party_id, discord_id)
);
CREATE INDEX IF NOT EXISTS idx_party_members_user ON party_members(discord_id);

CREATE TABLE IF NOT EXISTS party_leagues (
  party_id UUID NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'planning' CHECK (status IN ('planning', 'joined')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (party_id, league_id)
);

CREATE TABLE IF NOT EXISTS party_seekers (
  discord_id TEXT PRIMARY KEY,
  skills TEXT[] NOT NULL DEFAULT '{}',
  note TEXT CHECK (note IS NULL OR char_length(note) <= 200),
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Server-side only (service role). No direct client access.
ALTER TABLE leagues ENABLE ROW LEVEL SECURITY;
ALTER TABLE parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE party_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE party_leagues ENABLE ROW LEVEL SECURITY;
ALTER TABLE party_seekers ENABLE ROW LEVEL SECURITY;
