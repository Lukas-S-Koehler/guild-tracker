import { createAdminClient } from '@/lib/supabase-server';
import { formatGold } from '@/lib/utils';

export interface LookupCharacter {
  ign: string;
  isMain: boolean;
  tracked: boolean; // has a members row
  inDreamGuild: boolean;
  guildName: string | null;
  daysInGuild: number | null;
  totalGold: number;
  totalRaids: number;
  assaultRuns: number;
  assaultKills: number;
  assaultXp: number;
  lastAssaultKills: number | null;
}

export interface DiscordProfile {
  characters: LookupCharacter[];
}

interface MemberRow {
  id: string;
  ign: string;
  character_id: number | null;
  current_guild_id: string | null;
  is_active: boolean | null;
  first_seen: string | null;
}

const DAY_MS = 86_400_000;

export async function getDiscordProfile(discordId: string): Promise<DiscordProfile> {
  const supabase = createAdminClient();

  const { data: direct } = await supabase
    .from('members')
    .select('id')
    .eq('discord_id', discordId);
  const seedIds = new Set<string>((direct ?? []).map((m: { id: string }) => m.id));
  if (seedIds.size === 0) return { characters: [] };

  // Expand through member_alts (both directions). Dedupe by alt_hashed_id.
  const idList = Array.from(seedIds);
  const { data: altRows } = await supabase
    .from('member_alts')
    .select('member_id, alt_ign, alt_hashed_id, alt_member_id')
    .or(`member_id.in.(${idList.join(',')}),alt_member_id.in.(${idList.join(',')})`);

  type AltRow = { member_id: string; alt_ign: string; alt_hashed_id: string; alt_member_id: string | null };
  const alts = (altRows ?? []) as AltRow[];
  const allIds = new Set(seedIds);
  for (const a of alts) {
    allIds.add(a.member_id);
    if (a.alt_member_id) allIds.add(a.alt_member_id);
  }
  // Second hop: pull in all alts of any main discovered via an alt link
  const mainIds = new Set(alts.map(a => a.member_id));
  const missingMains = Array.from(mainIds).filter(id => !seedIds.has(id));
  if (missingMains.length > 0) {
    const { data: more } = await supabase
      .from('member_alts')
      .select('member_id, alt_ign, alt_hashed_id, alt_member_id')
      .in('member_id', missingMains);
    const seen = new Set(alts.map(a => `${a.member_id}:${a.alt_hashed_id}`));
    for (const a of (more ?? []) as AltRow[]) {
      if (seen.has(`${a.member_id}:${a.alt_hashed_id}`)) continue;
      alts.push(a);
      if (a.alt_member_id) allIds.add(a.alt_member_id);
    }
  }

  const ids = Array.from(allIds);
  const [membersRes, lbRes, histRes, guildsRes] = await Promise.all([
    supabase.from('members').select('id, ign, character_id, current_guild_id, is_active, first_seen').in('id', ids),
    supabase.from('v_global_leaderboard').select('id, total_raids, total_gold').in('id', ids),
    supabase.from('member_guild_history').select('member_id, joined_at').in('member_id', ids).is('left_at', null),
    supabase.from('guilds').select('id, name, nickname, is_active'),
  ]);

  const members = (membersRes.data ?? []) as MemberRow[];
  const lb = new Map<string, { total_raids: number; total_gold: number }>(
    (lbRes.data ?? []).map((r: { id: string; total_raids: number; total_gold: number }) => [r.id, r]),
  );
  const joined = new Map<string, string>();
  for (const h of (histRes.data ?? []) as { member_id: string; joined_at: string }[]) {
    const prev = joined.get(h.member_id);
    if (!prev || h.joined_at < prev) joined.set(h.member_id, h.joined_at);
  }
  const guilds = new Map<string, { name: string; nickname: string | null; is_active: boolean | null }>(
    ((guildsRes.data ?? []) as { id: string; name: string; nickname: string | null; is_active: boolean | null }[])
      .map(g => [g.id, g]),
  );

  // Assault stats keyed by character_id
  const charIds = members.map(m => m.character_id).filter((c): c is number => c != null);
  const assaultByChar = new Map<number, { runs: number; kills: number; xp: number; lastKills: number | null; lastAt: string }>();
  if (charIds.length > 0) {
    const { data: contribs } = await supabase
      .from('assault_contributions')
      .select('run_id, character_id, kills, experience')
      .in('character_id', charIds);
    const rows = (contribs ?? []) as { run_id: string; character_id: number; kills: number; experience: number }[];
    const runIds = Array.from(new Set(rows.map(r => r.run_id)));
    const startsAt = new Map<string, string>();
    if (runIds.length > 0) {
      const { data: runs } = await supabase.from('assault_runs').select('id, starts_at').in('id', runIds);
      for (const r of (runs ?? []) as { id: string; starts_at: string }[]) startsAt.set(r.id, r.starts_at);
    }
    for (const r of rows) {
      const at = startsAt.get(r.run_id) ?? '';
      const cur = assaultByChar.get(r.character_id) ?? { runs: 0, kills: 0, xp: 0, lastKills: null, lastAt: '' };
      cur.runs += 1;
      cur.kills += r.kills;
      cur.xp += r.experience;
      if (at >= cur.lastAt) { cur.lastAt = at; cur.lastKills = r.kills; }
      assaultByChar.set(r.character_id, cur);
    }
  }

  // Main = member that owns alt rows; otherwise lowest character_id among the group
  const ownerIds = new Set(alts.map(a => a.member_id));
  const sortedByChar = [...members].sort((a, b) => (a.character_id ?? Infinity) - (b.character_id ?? Infinity));
  const mainId = ownerIds.size === 1 ? Array.from(ownerIds)[0] : (ownerIds.size > 1 ? sortedByChar.find(m => ownerIds.has(m.id))?.id : sortedByChar[0]?.id);

  const now = Date.now();
  const characters: LookupCharacter[] = members.map(m => {
    const g = m.current_guild_id ? guilds.get(m.current_guild_id) : undefined;
    const inDream = !!(m.is_active && g && g.is_active !== false);
    const start = joined.get(m.id) ?? m.first_seen;
    const stats = lb.get(m.id);
    const as = m.character_id != null ? assaultByChar.get(m.character_id) : undefined;
    return {
      ign: m.ign,
      isMain: m.id === mainId,
      tracked: true,
      inDreamGuild: inDream,
      guildName: inDream ? (g!.nickname ?? g!.name) : null,
      daysInGuild: inDream && start ? Math.max(0, Math.floor((now - new Date(start).getTime()) / DAY_MS)) : null,
      totalGold: Number(stats?.total_gold ?? 0),
      totalRaids: Number(stats?.total_raids ?? 0),
      assaultRuns: as?.runs ?? 0,
      assaultKills: as?.kills ?? 0,
      assaultXp: as?.xp ?? 0,
      lastAssaultKills: as?.lastKills ?? null,
    };
  });

  // Alts without a tracked member row = not in a Dream guild
  const trackedIgns = new Set(members.map(m => m.ign.toLowerCase()));
  const seenAlt = new Set<string>();
  for (const a of alts) {
    if (a.alt_member_id || seenAlt.has(a.alt_hashed_id) || trackedIgns.has(a.alt_ign.toLowerCase())) continue;
    seenAlt.add(a.alt_hashed_id);
    characters.push({
      ign: a.alt_ign, isMain: false, tracked: false, inDreamGuild: false, guildName: null,
      daysInGuild: null, totalGold: 0, totalRaids: 0, assaultRuns: 0, assaultKills: 0, assaultXp: 0, lastAssaultKills: null,
    });
  }

  characters.sort((a, b) => Number(b.isMain) - Number(a.isMain) || Number(b.inDreamGuild) - Number(a.inDreamGuild));
  return { characters };
}

export function formatCharacterLine(c: LookupCharacter): string {
  const tag = c.isMain ? '👑 **Main**' : 'Alt';
  if (!c.inDreamGuild) return `${tag} · **${c.ign}** — not in a Dream guild`;
  const parts = [
    c.guildName ?? '?',
    c.daysInGuild != null ? `${c.daysInGuild}d` : null,
    `${formatGold(c.totalGold)} gold`,
    `${c.totalRaids.toLocaleString()} raids`,
  ].filter(Boolean);
  let line = `${tag} · **${c.ign}** — ${parts.join(' · ')}`;
  if (c.assaultRuns > 0) {
    line += `\n⚔️ ${c.assaultRuns} assault${c.assaultRuns === 1 ? '' : 's'} · ${c.assaultKills.toLocaleString()} kills · ${formatGold(c.assaultXp)} XP` +
      (c.lastAssaultKills != null ? ` (last: ${c.lastAssaultKills.toLocaleString()})` : '');
  }
  return line;
}
