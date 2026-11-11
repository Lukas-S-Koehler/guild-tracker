-- Manual alt links: distinguish sync-derived vs leader-set links.
-- Manual rows are preserved across syncs and only removed when:
--   (a) the member record disappears (ON DELETE CASCADE), or
--   (b) a leader explicitly deletes them.
-- Sync rows are rewritten on every sync.

ALTER TABLE member_alts
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'sync'
  CHECK (source IN ('sync', 'manual'));

CREATE INDEX IF NOT EXISTS member_alts_source_idx ON member_alts(source);
