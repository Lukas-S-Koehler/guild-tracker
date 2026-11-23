/**
 * Discord role sync (Dream Hub step 8): in-game guild + position → Discord roles, add AND remove.
 *
 *  - Every active character in active Dream guild X gives its Discord user `Member - X`.
 *  - OFFICER / DEPUTY / LEADER also get `Staff - X`.
 *  - Known people (a character with this discord_id exists) in no Dream guild get `Retired Member`,
 *    which is removed again when they rejoin.
 *  - Only the roles listed here are ever touched. Global Officer/Deputy/Leadership/Holiday sit above
 *    DreamBot's role and stay manual.
 *  - Unmapped people (no character with their discord_id) are never changed, only reported.
 *  - `discord_role_keeps` rows are never removed (e.g. assault staff who aren't officers in game).
 *
 * The full plan needs the Server Members intent (lists the whole server). Single-user sync
 * (`syncDiscordUser`, after /claim or /map) works without it.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { addGuildMemberRole, getGuildMember, listAllGuildMembers, removeGuildMemberRole, type DiscordGuildMember } from '@/lib/discord-api';
import { DISCORD_SERVER_ID } from '@/lib/discord-live';

/** guilds.id → Discord roles. Role ids from the Dream Guilds server (2026-11-23). */
export const GUILD_ROLES: Record<string, { tag: string; member: string; staff: string }> = {
  '111': { tag: 'DT', member: '1444779317044183223', staff: '1445472952320524428' },
  '171': { tag: 'DR', member: '1444779653330895041', staff: '1444754069796159612' },
  '292': { tag: 'DG', member: '1444757330230247559', staff: '1446265670940627106' },
  '751': { tag: 'DW', member: '1444779919619002622', staff: '1450583315387125760' },
  '735': { tag: 'DU', member: '1444779884839960666', staff: '1444969180402024488' },
  '785': { tag: 'DC', member: '1444779968428114082', staff: '1450583211674435674' },
  '554': { tag: 'DB', member: '1444779787682975936', staff: '1450583394504413416' },
  '845': { tag: 'DP', member: '1444780030956670986', staff: '1447914844723609661' },
  '1106': { tag: 'DA', member: '1444780084618854520', staff: '1447913438784393247' },
  '955': { tag: 'DK', member: '1503468618078355607', staff: '1503468444480442682' },
  '576': { tag: 'CD', member: '1444780671405920347', staff: '1444961691925483613' },
  '138': { tag: 'DI', member: '1444772879483797714', staff: '1450584362264563855' },
  '1184': { tag: 'DE', member: '1457858167726805154', staff: '1457858504156250366' },
};
export const RETIRED_ROLE = '1452334231807201393';
const STAFF_POSITIONS = new Set(['OFFICER', 'DEPUTY', 'LEADER']);

const ROLE_NAMES = new Map<string, string>([[RETIRED_ROLE, 'Retired Member']]);
for (const g of Object.values(GUILD_ROLES)) {
  ROLE_NAMES.set(g.member, `Member - ${g.tag}`);
  ROLE_NAMES.set(g.staff, `Staff - ${g.tag}`);
}
export const MANAGED_ROLES = new Set(ROLE_NAMES.keys());
export const roleName = (id: string) => ROLE_NAMES.get(id) ?? id;

export interface RoleChange {
  discord_id: string;
  name: string;
  /** IGNs behind this Discord user (active first). */
  characters: string[];
  add: string[];
  remove: string[];
  /** Removals skipped because of a keep. */
  kept: string[];
}

export interface RolePlan {
  changes: RoleChange[];
  /** Unmapped server members holding managed roles: reported, never changed. */
  unmapped: { discord_id: string; name: string; roles: string[] }[];
  scanned: number;
}

type CharRow = { discord_id: string; ign: string; is_active: boolean | null; current_guild_id: string | null; position: string | null };

async function loadCharacters(supabase: SupabaseClient, discordIds?: string[]): Promise<Map<string, CharRow[]>> {
  const out = new Map<string, CharRow[]>();
  for (let from = 0; ; from += 1000) {
    let q = supabase.from('members').select('discord_id, ign, is_active, current_guild_id, position').not('discord_id', 'is', null).order('id');
    if (discordIds) q = q.in('discord_id', discordIds);
    const { data, error } = await q.range(from, from + 999);
    if (error) throw error;
    for (const r of (data ?? []) as CharRow[]) out.set(r.discord_id, [...(out.get(r.discord_id) ?? []), r]);
    if (!data || data.length < 1000) return out;
  }
}

async function loadKeeps(supabase: SupabaseClient): Promise<Set<string>> {
  const { data } = await supabase.from('discord_role_keeps').select('discord_id, role_id');
  return new Set((data ?? []).map((k) => `${k.discord_id}:${k.role_id}`));
}

/**
 * Guilds that count. Inactive guilds (guilds.is_active = false) aren't synced any more, so their
 * member rows are stale: their roles are only ever removed.
 */
async function loadActiveGuilds(supabase: SupabaseClient): Promise<Set<string>> {
  const { data, error } = await supabase.from('guilds').select('id, is_active');
  if (error) throw error;
  return new Set((data ?? []).filter((g) => g.is_active !== false).map((g) => g.id as string));
}

/** Roles a known person should hold. */
export function desiredRoles(chars: CharRow[], activeGuilds: Set<string>): Set<string> {
  const want = new Set<string>();
  for (const c of chars) {
    if (!c.is_active || !c.current_guild_id || !activeGuilds.has(c.current_guild_id)) continue;
    const g = GUILD_ROLES[c.current_guild_id];
    if (!g) continue;
    want.add(g.member);
    if (STAFF_POSITIONS.has((c.position ?? '').toUpperCase())) want.add(g.staff);
  }
  if (want.size === 0) want.add(RETIRED_ROLE);
  return want;
}

const displayOf = (m: DiscordGuildMember) => m.nick ?? m.user?.global_name ?? m.user?.username ?? m.user?.id ?? '?';

function diff(member: DiscordGuildMember, chars: CharRow[], keeps: Set<string>, activeGuilds: Set<string>): RoleChange | null {
  const id = member.user!.id;
  const want = desiredRoles(chars, activeGuilds);
  const have = new Set(member.roles.filter((r) => MANAGED_ROLES.has(r)));
  const add = Array.from(want).filter((r) => !have.has(r));
  const removeAll = Array.from(have).filter((r) => !want.has(r));
  const kept = removeAll.filter((r) => keeps.has(`${id}:${r}`));
  const remove = removeAll.filter((r) => !keeps.has(`${id}:${r}`));
  if (!add.length && !remove.length && !kept.length) return null;
  const sorted = [...chars].sort((a, b) => Number(!!b.is_active) - Number(!!a.is_active));
  return { discord_id: id, name: displayOf(member), characters: sorted.map((c) => c.ign), add, remove, kept };
}

/** Dry run over the whole server. Throws a readable error when the members intent is off. */
export async function planRoleSync(supabase: SupabaseClient): Promise<RolePlan> {
  let members: DiscordGuildMember[];
  try {
    members = await listAllGuildMembers(DISCORD_SERVER_ID);
  } catch (err) {
    if (String(err).includes('50001') || String(err).includes('Discord API 403')) {
      throw new Error('DreamBot cannot list server members. Enable "Server Members Intent" in the Discord Developer Portal → DreamBot → Bot.');
    }
    throw err;
  }
  const [chars, keeps, active] = await Promise.all([loadCharacters(supabase), loadKeeps(supabase), loadActiveGuilds(supabase)]);
  const changes: RoleChange[] = [];
  const unmapped: RolePlan['unmapped'] = [];
  for (const m of members) {
    if (!m.user || m.user.bot) continue;
    const c = chars.get(m.user.id);
    if (!c) {
      const held = m.roles.filter((r) => MANAGED_ROLES.has(r) && r !== RETIRED_ROLE);
      if (held.length) unmapped.push({ discord_id: m.user.id, name: displayOf(m), roles: held });
      continue;
    }
    const d = diff(m, c, keeps, active);
    if (d && (d.add.length || d.remove.length)) changes.push(d);
  }
  changes.sort((a, b) => a.name.localeCompare(b.name));
  unmapped.sort((a, b) => a.name.localeCompare(b.name));
  return { changes, unmapped, scanned: members.length };
}

const pace = () => new Promise((r) => setTimeout(r, 250));

/** Apply a list of changes. Returns per-user errors. */
export async function applyRoleChanges(changes: RoleChange[]) {
  let added = 0;
  let removed = 0;
  const errors: { discord_id: string; error: string }[] = [];
  for (const c of changes) {
    for (const r of c.add) {
      const res = await addGuildMemberRole(DISCORD_SERVER_ID, c.discord_id, r);
      if (res.ok) added++;
      else errors.push({ discord_id: c.discord_id, error: `add ${roleName(r)}: ${res.error}` });
      await pace();
    }
    for (const r of c.remove) {
      const res = await removeGuildMemberRole(DISCORD_SERVER_ID, c.discord_id, r);
      if (res.ok) removed++;
      else errors.push({ discord_id: c.discord_id, error: `remove ${roleName(r)}: ${res.error}` });
      await pace();
    }
  }
  return { added, removed, errors };
}

/** Sync one person right away (after /claim, /map). No-op when they aren't in the server. */
export async function syncDiscordUser(supabase: SupabaseClient, discordId: string): Promise<RoleChange | null> {
  const member = await getGuildMember(DISCORD_SERVER_ID, discordId);
  if (!member?.user) return null;
  const chars = (await loadCharacters(supabase, [discordId])).get(discordId);
  if (!chars?.length) return null;
  const d = diff(member, chars, await loadKeeps(supabase), await loadActiveGuilds(supabase));
  if (!d || (!d.add.length && !d.remove.length)) return null;
  await applyRoleChanges([d]);
  return d;
}

export const AUTO_SYNC_SETTING = 'discord_role_sync_auto';
