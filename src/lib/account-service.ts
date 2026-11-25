/**
 * Website account ↔ IdleMMO characters.
 *
 * Approved claims (user_characters) + member_alts closure = the user's characters.
 * Guild access is derived from where those characters are right now:
 * guild_leaders rows with source='derived' are rewritten to match; rows with
 * source='manual' are super admin overrides and are never touched.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase-server';
import { getAccountMemberIds } from '@/lib/alt-graph';
import { SUPER_ADMIN_EMAIL } from '@/lib/auth-helpers';
import { activeJoins, withJoining } from '@/lib/guild-joining';

export type SiteRole = 'MEMBER' | 'OFFICER' | 'DEPUTY' | 'LEADER';
const ROLE_RANK: Record<SiteRole, number> = { MEMBER: 0, OFFICER: 1, DEPUTY: 2, LEADER: 3 };

/** In-game guild position → website role. */
export function roleFromPosition(position: string | null | undefined): SiteRole {
  switch ((position ?? '').toUpperCase()) {
    case 'LEADER':
      return 'LEADER';
    case 'DEPUTY':
      return 'DEPUTY';
    case 'OFFICER':
      return 'OFFICER';
    default:
      return 'MEMBER';
  }
}

export interface AccountCharacter {
  member_id: string;
  ign: string;
  hashed_id: string | null;
  avatar_url: string | null;
  class: string | null;
  total_level: number | null;
  position: string | null;
  guild_id: string | null;
  guild_name: string | null;
  guild_nickname: string | null;
  /** In one of the guilds in `guilds` and still active there. */
  in_dream_guild: boolean;
  /** Directly claimed (vs. picked up as an alt). */
  claimed: boolean;
  /** Marked as joining guild_id by staff (in-game move still on cooldown), until this time. */
  joining_until?: string | null;
}

export async function getAccountCharacters(
  userId: string,
  supabase: SupabaseClient = createAdminClient()
): Promise<AccountCharacter[]> {
  const { data: claims } = await supabase
    .from('user_characters')
    .select('member_id')
    .eq('user_id', userId)
    .eq('status', 'approved');
  const claimedIds = (claims ?? []).map((c) => c.member_id as string);
  if (claimedIds.length === 0) return [];

  const ids = Array.from(await getAccountMemberIds(supabase, claimedIds));
  return getBundleCharacters(ids, new Set(claimedIds), supabase);
}

/** Characters for a known bundle of member ids (claimed ones first, then by level). */
export async function getBundleCharacters(
  ids: string[],
  claimedSet: Set<string>,
  supabase: SupabaseClient = createAdminClient()
): Promise<AccountCharacter[]> {
  if (ids.length === 0) return [];
  const [{ data: members }, { data: guilds }, joins] = await Promise.all([
    supabase
      .from('members')
      .select('id, ign, hashed_id, avatar_url, class, total_level, position, current_guild_id, is_active')
      .in('id', ids),
    supabase.from('guilds').select('id, name, nickname'),
    activeJoins(supabase, ids),
  ]);
  const guildMap = new Map((guilds ?? []).map((g) => [g.id as string, g]));

  return (members ?? [])
    .map((raw) => {
      // Joining (src/lib/guild-joining.ts): shown as a recruit of the target guild until the move lands.
      const m = withJoining(raw, joins);
      const g = m.current_guild_id ? guildMap.get(m.current_guild_id) : undefined;
      return {
        member_id: m.id,
        ign: m.ign,
        hashed_id: m.hashed_id,
        avatar_url: m.avatar_url,
        class: m.class,
        total_level: m.total_level,
        position: m.position,
        guild_id: m.current_guild_id,
        guild_name: g?.name ?? null,
        guild_nickname: g?.nickname ?? null,
        in_dream_guild: !!g && m.is_active !== false,
        claimed: claimedSet.has(m.id),
        joining_until: m.joining?.until ?? null,
      };
    })
    .sort((a, b) => Number(b.claimed) - Number(a.claimed) || (b.total_level ?? 0) - (a.total_level ?? 0));
}

export type ClaimLock = { claim_id: string; user_id: string; status: 'pending' | 'approved'; claimed_member_id: string };

/**
 * Active (pending/approved) claims touching any character in the same account
 * bundle as `memberId`. One claim covers the whole bundle, so a hit on any alt
 * means the character is taken.
 */
export async function findBundleLocks(memberId: string, supabase: SupabaseClient = createAdminClient()) {
  const bundle = Array.from(await getAccountMemberIds(supabase, [memberId]));
  const { data } = await supabase
    .from('user_characters')
    .select('id, user_id, status, member_id')
    .in('member_id', bundle)
    .in('status', ['pending', 'approved']);
  const locks: ClaimLock[] = (data ?? []).map((r) => ({
    claim_id: r.id,
    user_id: r.user_id,
    status: r.status,
    claimed_member_id: r.member_id,
  }));
  return { bundle, locks };
}

/** Map of every locked character (claims expanded over their alt bundles). */
export async function getAllClaimLocks(supabase: SupabaseClient = createAdminClient()) {
  const { data } = await supabase
    .from('user_characters')
    .select('id, user_id, status, member_id')
    .in('status', ['pending', 'approved']);
  const locks = new Map<string, ClaimLock>();
  await Promise.all(
    (data ?? []).map(async (r) => {
      const ids = await getAccountMemberIds(supabase, [r.member_id]);
      const lock: ClaimLock = { claim_id: r.id, user_id: r.user_id, status: r.status, claimed_member_id: r.member_id };
      ids.forEach((id) => {
        // approved wins over pending if bundles ever overlap
        const cur = locks.get(id);
        if (!cur || (cur.status === 'pending' && lock.status === 'approved')) locks.set(id, lock);
      });
    })
  );
  return locks;
}

/** The user's single active claim, if any. */
export async function getActiveClaim(userId: string, supabase: SupabaseClient = createAdminClient()) {
  const { data } = await supabase
    .from('user_characters')
    .select('id, member_id, status, member:members(ign)')
    .eq('user_id', userId)
    .in('status', ['pending', 'approved'])
    .maybeSingle();
  if (!data) return null;
  return { ...data, ign: (data.member as unknown as { ign: string } | null)?.ign ?? 'a character' };
}

/** Rewrite the user's derived guild_leaders rows from their characters' current guilds. */
export async function recomputeUserGuildAccess(userId: string, supabase: SupabaseClient = createAdminClient()) {
  const chars = await getAccountCharacters(userId, supabase);

  const wanted = new Map<string, SiteRole>();
  for (const c of chars) {
    if (!c.in_dream_guild || !c.guild_id) continue;
    const role = roleFromPosition(c.position);
    const cur = wanted.get(c.guild_id);
    if (!cur || ROLE_RANK[role] > ROLE_RANK[cur]) wanted.set(c.guild_id, role);
  }

  const { data: rows } = await supabase
    .from('guild_leaders')
    .select('id, guild_id, role, source')
    .eq('user_id', userId);
  const existing = new Map((rows ?? []).map((r) => [r.guild_id as string, r]));

  const inserts: { guild_id: string; user_id: string; role: SiteRole; source: 'derived' }[] = [];
  const updates: { id: string; role: SiteRole }[] = [];
  const deletes: string[] = [];

  wanted.forEach((role, guildId) => {
    const row = existing.get(guildId);
    if (!row) inserts.push({ guild_id: guildId, user_id: userId, role, source: 'derived' });
    else if (row.source === 'derived' && row.role !== role) updates.push({ id: row.id, role });
  });
  for (const r of rows ?? []) {
    if (r.source === 'derived' && !wanted.has(r.guild_id)) deletes.push(r.id);
  }

  if (inserts.length) await supabase.from('guild_leaders').insert(inserts);
  for (const u of updates) await supabase.from('guild_leaders').update({ role: u.role }).eq('id', u.id);
  if (deletes.length) await supabase.from('guild_leaders').delete().in('id', deletes);

  return { added: inserts.length, updated: updates.length, removed: deletes.length };
}

/** Run after members sync so guild moves / promotions / leaving are reflected. */
export async function recomputeAllClaimedUsers(supabase: SupabaseClient = createAdminClient()) {
  const { data } = await supabase.from('user_characters').select('user_id').eq('status', 'approved');
  const users = Array.from(new Set((data ?? []).map((r) => r.user_id as string)));
  let changed = 0;
  for (const u of users) {
    const r = await recomputeUserGuildAccess(u, supabase);
    changed += r.added + r.updated + r.removed;
  }
  return { users: users.length, changed };
}

/**
 * Guild ids a reviewer may approve claims for. null = all (super admin).
 * Reviewers: LEADER/DEPUTY/OFFICER of the guild (manual or derived row).
 */
export async function reviewableGuildIds(
  user: { id: string; email?: string },
  supabase: SupabaseClient = createAdminClient()
): Promise<string[] | null> {
  if (user.email === SUPER_ADMIN_EMAIL) return null;
  const { data } = await supabase
    .from('guild_leaders')
    .select('guild_id, role')
    .eq('user_id', user.id)
    .in('role', ['OFFICER', 'DEPUTY', 'LEADER']);
  return (data ?? []).map((r) => r.guild_id as string);
}
