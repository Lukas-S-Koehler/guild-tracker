-- ============================================================================
-- Claims: one IdleMMO account per website user
--
-- * A claim covers the whole account bundle (claimed character + every alt in
--   the member_alts closure, up to 5 characters).
-- * A user can hold at most ONE active claim (pending or approved). To claim a
--   different account they release the current one first.
-- * A character is locked as soon as someone has a PENDING claim on it, not
--   only once approved. Bundle-level locking (alts) is enforced in the API,
--   since the alt closure can't be expressed as an index.
-- Depends on: account-claims.sql
-- Safe to re-run. Checked 2026-11-22: no user/character currently violates it.
-- ============================================================================

DROP INDEX IF EXISTS idx_user_characters_one_owner;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_characters_one_active_per_member
  ON user_characters(member_id) WHERE status IN ('pending', 'approved');

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_characters_one_active_per_user
  ON user_characters(user_id) WHERE status IN ('pending', 'approved');
