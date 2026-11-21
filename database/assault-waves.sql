-- Per-wave tracking. Inspect returns season-cumulative totals per character, so each
-- run stores the cumulative snapshot at the end of its wave; the next wave's
-- contribution = cumulative - previous wave's snapshot (assault_contributions = wave delta).
CREATE TABLE IF NOT EXISTS assault_run_snapshots (
  run_id UUID NOT NULL REFERENCES assault_runs(id) ON DELETE CASCADE,
  character_id INTEGER NOT NULL,
  kills BIGINT NOT NULL DEFAULT 0,
  experience BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (run_id, character_id)
);
