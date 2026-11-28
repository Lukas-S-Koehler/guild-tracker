-- "No Discord" flag: staff mark a member who has no Discord account (via /map ign:<x> no_discord:true).
-- Only effect: the member is left out of the Unmapped Members Report. They stay in /map autocomplete,
-- admin mapping pages etc. As soon as a discord_id is set (any path) the flag clears itself.
-- Run manually in the Supabase SQL editor BEFORE deploying.

ALTER TABLE members ADD COLUMN IF NOT EXISTS no_discord BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION members_clear_no_discord() RETURNS trigger AS $$
BEGIN
  IF NEW.discord_id IS NOT NULL THEN
    NEW.no_discord := false;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS members_clear_no_discord_trg ON members;
CREATE TRIGGER members_clear_no_discord_trg
  BEFORE INSERT OR UPDATE OF discord_id, no_discord ON members
  FOR EACH ROW EXECUTE FUNCTION members_clear_no_discord();
