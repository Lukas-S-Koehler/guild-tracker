/**
 * "Joining" state: a player applied and left their old guild, but the in-game guild move is still
 * on cooldown (24h). Staff mark the character as joining a Dream guild on the Recruiting tab; until
 * the members sync sees them in that guild (or the window runs out) the site treats that one
 * character as a RECRUIT of the target guild:
 *   - account characters (access gates, nav, /combat, My assault, derived website role)
 *   - Discord role sync (Member - <guild> is kept instead of stripped)
 *   - assault roster sync (gets a roster row in the target assault guild)
 *   - claims (the character can be claimed although it sits in no Dream guild right now)
 * Guild stats, activity and streaks read the members table directly and never see this.
 *
 * Stored on recruit_prospects (joining_member_id / joining_guild_id / joining_until).
 * Read-only helpers live here; start/extend/end/expire are in guild-joining-actions.ts.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

/** Default window: the 24h cooldown plus a day of slack for the next members sync. */
export const JOINING_HOURS = 48;
export const JOINING_POSITION = 'RECRUIT';

export interface ActiveJoin {
  prospect_id: string;
  member_id: string;
  guild_id: string;
  until: string;
}

/** Active (not expired) joins, keyed by member id. Pass ids to limit the lookup. */
export async function activeJoins(supabase: SupabaseClient, memberIds?: string[]): Promise<Map<string, ActiveJoin>> {
  const out = new Map<string, ActiveJoin>();
  if (memberIds && !memberIds.length) return out;
  let q = supabase
    .from('recruit_prospects')
    .select('id, joining_member_id, joining_guild_id, joining_until')
    .not('joining_member_id', 'is', null)
    .not('joining_guild_id', 'is', null)
    .gt('joining_until', new Date().toISOString());
  if (memberIds) q = q.in('joining_member_id', memberIds);
  const { data, error } = await q;
  // Migration not run yet → behave as if nobody is joining.
  if (error) return out;
  for (const r of data ?? []) {
    out.set(r.joining_member_id as string, {
      prospect_id: r.id as string,
      member_id: r.joining_member_id as string,
      guild_id: String(r.joining_guild_id),
      until: r.joining_until as string,
    });
  }
  return out;
}

/**
 * A members row as the site should see it: a joining character sits in its target guild as a
 * recruit. Characters already active in the target guild are returned unchanged.
 */
export function withJoining<T extends { id: string; current_guild_id: string | null; is_active: boolean | null; position?: string | null }>(
  row: T,
  joins: Map<string, ActiveJoin>
): T & { joining?: ActiveJoin } {
  const j = joins.get(row.id);
  if (!j) return row;
  if (row.current_guild_id === j.guild_id && row.is_active !== false) return row;
  return { ...row, current_guild_id: j.guild_id, is_active: true, position: JOINING_POSITION, joining: j };
}
