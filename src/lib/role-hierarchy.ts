/**
 * Staff hierarchy: super admin > leader > deputy > officer > member.
 * Rule everywhere a staff member acts on another person (revoke/reject a claim, change or remove
 * a site role, grant a role through a claim): you may only act on people ranked BELOW you,
 * and only grant roles below your own. The super admin is above everyone and can't be touched.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { SUPER_ADMIN_EMAIL } from '@/lib/auth-helpers';

export type Rank = 'MEMBER' | 'OFFICER' | 'DEPUTY' | 'LEADER' | 'SUPER';
export const RANK: Record<Rank, number> = { MEMBER: 0, OFFICER: 1, DEPUTY: 2, LEADER: 3, SUPER: 4 };
export const RANK_LABEL: Record<Rank, string> = { MEMBER: 'member', OFFICER: 'officer', DEPUTY: 'deputy', LEADER: 'leader', SUPER: 'super admin' };

const rankOf = (role: string | null | undefined): number => RANK[(role ?? 'MEMBER').toUpperCase() as Rank] ?? 0;
const nameOf = (n: number): string => RANK_LABEL[(Object.keys(RANK) as Rank[]).find((k) => RANK[k] === n) ?? 'MEMBER'];

/** True when an actor of rank `actor` may act on someone of rank `target`. */
export const outranks = (actor: number, target: number) => actor === RANK.SUPER || actor > target;

async function isSuperUser(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await supabase.auth.admin.getUserById(userId);
  return data?.user?.email === SUPER_ADMIN_EMAIL;
}

/** Actor's rank in one guild (super admin = SUPER everywhere). */
export async function rankInGuild(
  supabase: SupabaseClient,
  user: { id: string; email?: string },
  guildId: string | null
): Promise<number> {
  if (user.email === SUPER_ADMIN_EMAIL) return RANK.SUPER;
  if (!guildId) return RANK.MEMBER;
  const { data } = await supabase.from('guild_leaders').select('role').eq('user_id', user.id).eq('guild_id', guildId);
  return Math.max(RANK.MEMBER, ...(data ?? []).map((r) => rankOf(r.role)));
}

/**
 * Ranks for many users at once. `guildId` set → rank in that guild, else highest rank in any guild.
 * Super admin is detected by email (needs the service-role client).
 */
export async function ranksOf(supabase: SupabaseClient, userIds: string[], guildId?: string): Promise<Map<string, number>> {
  const out = new Map<string, number>(userIds.map((id) => [id, RANK.MEMBER]));
  if (!userIds.length) return out;
  let q = supabase.from('guild_leaders').select('user_id, role').in('user_id', userIds);
  if (guildId) q = q.eq('guild_id', guildId);
  const { data } = await q;
  for (const r of data ?? []) out.set(r.user_id, Math.max(out.get(r.user_id) ?? 0, rankOf(r.role)));
  await Promise.all(userIds.map(async (id) => { if (await isSuperUser(supabase, id)) out.set(id, RANK.SUPER); }));
  return out;
}

export async function rankOfUser(supabase: SupabaseClient, userId: string, guildId?: string): Promise<number> {
  return (await ranksOf(supabase, [userId], guildId)).get(userId) ?? RANK.MEMBER;
}

/** Rank a role name maps to (MEMBER/OFFICER/DEPUTY/LEADER, or an in-game position). */
export const rankOfRole = rankOf;

/** Standard refusal text. */
export const outrankError = (actor: number, target: number, verb: string) =>
  target >= RANK.SUPER
    ? `Nobody can ${verb} the super admin`
    : `As ${nameOf(actor)} you can only ${verb} people ranked below you (they are ${nameOf(target)})`;

export const grantError = (actor: number, granted: number) =>
  `As ${nameOf(actor)} you can't grant ${nameOf(granted)} access. Ask someone ranked higher.`;
