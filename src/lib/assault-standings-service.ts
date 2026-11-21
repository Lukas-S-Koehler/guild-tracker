import { createAdminClient } from '@/lib/supabase-server';
import { IdleMMOApi, type ConquestZone } from '@/lib/idlemmo-api';
import { getLocationMeta } from '@/lib/world-locations';

const FALLBACK_SEASON = 13;

export function toInt(x: string | number | undefined | null): number {
  if (x == null) return 0;
  if (typeof x === 'number') return x;
  return parseInt(String(x).replace(/,/g, ''), 10) || 0;
}

export async function getCurrentSeason(): Promise<number> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('assault_seasons')
    .select('season_number')
    .is('ended_at', null)
    .order('season_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { season_number: number } | null)?.season_number ?? FALLBACK_SEASON;
}

/** Page through a query (Supabase caps responses at 1000 rows). */
async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data as T[]) ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Writers
// ---------------------------------------------------------------------------

export async function storeZoneStandings(zone: ConquestZone, season: number): Promise<number> {
  const rows = (zone.guilds ?? []).map(g => ({
    season_number: season,
    zone_id: zone.location.id,
    zone_name: zone.location.name,
    external_guild_id: g.guild.id,
    guild_name: g.guild.name,
    guild_tag: g.guild.tag,
    position: g.position,
    zone_guild_count: zone.guilds.length,
    kills: toInt(g.kills),
    experience: toInt(g.experience),
    snapshot_at: new Date().toISOString(),
  }));
  if (rows.length === 0) return 0;
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('assault_zone_standings')
    .upsert(rows, { onConflict: 'season_number,zone_id,external_guild_id' });
  if (error) throw new Error(error.message);
  return rows.length;
}

/** Store per-character season totals for our tracked guilds from an inspect response. */
export async function storeSeasonContributions(zone: ConquestZone, season: number, trackedIds: Set<number>): Promise<number> {
  const supabase = createAdminClient();
  let n = 0;
  for (const g of zone.guilds ?? []) {
    if (!trackedIds.has(g.guild.id)) continue;
    const rows = (g.contributions ?? []).map(c => ({
      season_number: season,
      zone_id: zone.location.id,
      external_guild_id: g.guild.id,
      character_id: c.character.id,
      character_hashed_id: c.character.hashed_id,
      character_name: c.character.name,
      total_level: c.character.total_level,
      kills: toInt(c.kills),
      experience: toInt(c.experience),
      snapshot_at: new Date().toISOString(),
    }));
    if (rows.length === 0) continue;
    const { error } = await supabase
      .from('assault_season_contributions')
      .upsert(rows, { onConflict: 'season_number,zone_id,external_guild_id,character_id' });
    if (error) throw new Error(error.message);
    n += rows.length;
  }
  return n;
}

/**
 * Sync standings for one season: one conquest-view call (all zones, all guilds),
 * then an inspect call per zone where one of our guilds appears (for member contributions).
 */
export async function syncSeason(
  api: IdleMMOApi,
  season: number,
  currentSeason: number,
  trackedIds: Set<number>,
): Promise<{ zones: number; standings: number; contributions: number; errors: string[] }> {
  const errors: string[] = [];
  const seasonParam = season === currentSeason ? undefined : season;
  const view = await api.getConquestView(seasonParam);
  let standings = 0;
  let contributions = 0;
  const zones = Object.values(view.zones);
  for (const zone of zones) {
    try {
      standings += await storeZoneStandings(zone, season);
      if (!zone.guilds?.some(g => trackedIds.has(g.guild.id))) continue;
      const inspect = await api.inspectConquestZone(zone.location.id, seasonParam);
      contributions += await storeSeasonContributions(inspect.zone, season, trackedIds);
    } catch (e) {
      errors.push(`zone ${zone.location.id}: ${String(e)}`);
    }
  }
  return { zones: zones.length, standings, contributions, errors };
}

/** True when the current season's standings are older than maxAgeMs. */
export async function standingsStale(season: number, maxAgeMs: number): Promise<boolean> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('assault_zone_standings')
    .select('snapshot_at')
    .eq('season_number', season)
    .order('snapshot_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const at = (data as { snapshot_at: string } | null)?.snapshot_at;
  return !at || Date.now() - new Date(at).getTime() > maxAgeMs;
}

// ---------------------------------------------------------------------------
// Readers
// ---------------------------------------------------------------------------

interface StandingRow {
  season_number: number; zone_id: number; zone_name: string; external_guild_id: number;
  guild_name: string; guild_tag: string | null; position: number; zone_guild_count: number;
  kills: number; experience: number;
}

export interface ZoneFinish {
  zone_id: number; zone_name: string; season_number: number;
  guild_id: number; guild_name: string; position: number; of: number; kills: number; experience: number;
}

export interface FieldEntry { position: number; guild_id: number; name: string; tag: string | null; experience: number; kills: number; ours: boolean; dream?: boolean }

export interface SeasonOverview {
  season: number;
  seasons: number[];
  guilds: Array<{
    guild_id: number; guild_name: string; guild_tag: string | null; note: string | null; last_active_season: number | null;
    overall_rank: number | null; of: number; experience: number; kills: number;
    zones: Array<{ zone_id: number; zone_name: string; image_url: string | null; position: number; of: number; kills: number; experience: number; leader: { name: string; experience: number } | null; field: FieldEntry[] }>;
  }>;
  snapshot_at: string | null;
}

export async function listStandingSeasons(): Promise<number[]> {
  const supabase = createAdminClient();
  const rows = await fetchAll<{ season_number: number }>((f, t) =>
    supabase.from('assault_zone_standings').select('season_number').range(f, t));
  return Array.from(new Set(rows.map(r => r.season_number))).sort((a, b) => b - a);
}

export interface TrackedGuild { external_id: number; local_id: string; name: string }

/** Our assault guilds (guilds.is_assault) with their external IdleMMO id + local name. */
export async function getTrackedGuilds(): Promise<TrackedGuild[]> {
  const supabase = createAdminClient();
  const { data: ag } = await supabase.from('guilds').select('id, name, nickname').eq('is_assault', true);
  const guilds = (ag ?? []) as { id: string; name: string; nickname: string | null }[];
  if (guilds.length === 0) return [];
  const { data } = await supabase
    .from('assault_configs')
    .select('guild_id, external_guild_id')
    .in('guild_id', guilds.map(g => g.id))
    .not('external_guild_id', 'is', null);
  const out: TrackedGuild[] = [];
  for (const r of (data ?? []) as { guild_id: string; external_guild_id: number }[]) {
    const g = guilds.find(x => x.id === r.guild_id);
    if (g) out.push({ external_id: r.external_guild_id, local_id: g.id, name: g.name });
  }
  return out;
}

/** External (IdleMMO) ids of our assault guilds only (guilds.is_assault), not every Dream guild. */
export async function getTrackedExternalIds(): Promise<number[]> {
  return Array.from(new Set((await getTrackedGuilds()).map(g => g.external_id)));
}

export async function getSeasonOverview(season: number, trackedGuilds: TrackedGuild[]): Promise<SeasonOverview> {
  const trackedIds = trackedGuilds.map(g => g.external_id);
  const supabase = createAdminClient();
  const rows = await fetchAll<StandingRow & { snapshot_at: string }>((f, t) =>
    supabase.from('assault_zone_standings').select('*').eq('season_number', season).range(f, t));

  // Overall rank: all guilds ranked by summed XP across zones
  const totals = new Map<number, { xp: number; kills: number }>();
  for (const r of rows) {
    const cur = totals.get(r.external_guild_id) ?? { xp: 0, kills: 0 };
    cur.xp += Number(r.experience); cur.kills += Number(r.kills);
    totals.set(r.external_guild_id, cur);
  }
  const ranked = Array.from(totals.entries()).sort((a, b) => b[1].xp - a[1].xp).map(([id]) => id);

  const meta = await getLocationMeta().catch(() => new Map());
  const fieldFor = (zoneId: number): FieldEntry[] => {
    const all = rows.filter(r => r.zone_id === zoneId).sort((a, b) => a.position - b.position).map(r => ({
      position: r.position, guild_id: r.external_guild_id, name: r.guild_name, tag: r.guild_tag,
      experience: Number(r.experience), kills: Number(r.kills), ours: trackedIds.includes(r.external_guild_id),
    }));
    const top = all.slice(0, 5);
    for (const e of all) if (e.ours && !top.some(t => t.guild_id === e.guild_id)) top.push(e);
    return top;
  };

  // Last season each tracked guild appeared in at all (for a friendly empty state)
  const lastActive = new Map<number, number>();
  for (const tg of trackedGuilds) {
    if (rows.some(r => r.external_guild_id === tg.external_id)) continue;
    const { data: la } = await supabase
      .from('assault_zone_standings')
      .select('season_number')
      .eq('external_guild_id', tg.external_id)
      .order('season_number', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (la) lastActive.set(tg.external_id, (la as { season_number: number }).season_number);
  }
  const guilds = trackedGuilds.map(tg => {
    const gid = tg.external_id;
    const mine = rows.filter(r => r.external_guild_id === gid);
    const rank = ranked.indexOf(gid);
    const t = totals.get(gid);
    return {
      guild_id: gid,
      guild_name: mine[0]?.guild_name ?? tg.name,
      guild_tag: mine[0]?.guild_tag ?? null,
      last_active_season: lastActive.get(gid) ?? null,
      note: mine.length ? null : (() => {
        const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, '');
        const alt = rows.find(r => norm(r.guild_name) === norm(tg.name) && r.external_guild_id !== gid);
        return alt
          ? `Standings list "${alt.guild_name}" under id ${alt.external_guild_id}, but assault_configs has ${gid}. Fix assault_configs.external_guild_id.`
          : lastActive.has(gid)
            ? `No assaults this season. Last active: season ${lastActive.get(gid)}.`
            : `No conquest activity recorded for this guild in any stored season.`;
      })(),
      overall_rank: rank >= 0 ? rank + 1 : null,
      of: ranked.length,
      experience: t?.xp ?? 0,
      kills: t?.kills ?? 0,
      zones: mine
        .map(m => {
          const leader = rows.filter(r => r.zone_id === m.zone_id).sort((a, b) => a.position - b.position)[0];
          return {
            zone_id: m.zone_id, zone_name: m.zone_name, image_url: meta.get(m.zone_id)?.image_url ?? null, position: m.position, of: m.zone_guild_count,
            kills: Number(m.kills), experience: Number(m.experience),
            leader: leader && leader.external_guild_id !== gid ? { name: leader.guild_name, experience: Number(leader.experience) } : null,
            field: fieldFor(m.zone_id),
          };
        })
        .sort((a, b) => a.position - b.position || b.experience - a.experience),
    };
  });

  guilds.sort((a, b) => (a.overall_rank ?? 1e9) - (b.overall_rank ?? 1e9));
  const latest = rows.map(r => r.snapshot_at).sort().pop() ?? null;
  return { season, seasons: await listStandingSeasons(), guilds, snapshot_at: latest };
}

/** Best finish per zone across all seasons for our guilds. */
export async function getBestFinishes(trackedIds: number[]): Promise<ZoneFinish[]> {
  if (trackedIds.length === 0) return [];
  const supabase = createAdminClient();
  const rows = await fetchAll<StandingRow>((f, t) =>
    supabase.from('assault_zone_standings').select('*').in('external_guild_id', trackedIds).range(f, t));
  const best = new Map<number, StandingRow>();
  for (const r of rows) {
    const cur = best.get(r.zone_id);
    if (!cur || r.position < cur.position || (r.position === cur.position && Number(r.experience) > Number(cur.experience))) {
      best.set(r.zone_id, r);
    }
  }
  const meta = await getLocationMeta().catch(() => new Map());
  return Array.from(best.values())
    .map(r => ({
      image_url: meta.get(r.zone_id)?.image_url ?? null,
      zone_id: r.zone_id, zone_name: r.zone_name, season_number: r.season_number,
      guild_id: r.external_guild_id, guild_name: r.guild_name, position: r.position,
      of: r.zone_guild_count, kills: Number(r.kills), experience: Number(r.experience),
    }))
    .sort((a, b) => a.position - b.position || b.experience - a.experience);
}

export interface TopAssaulter {
  character_id: number; character_name: string; total_level: number | null;
  guild_id: number; kills: number; experience: number; zones: number;
}

/** Best Dream assaulters by total XP (one season, or all-time when season omitted). */
export async function getTopAssaulters(trackedIds: number[], opts: { season?: number; limit?: number } = {}): Promise<TopAssaulter[]> {
  if (trackedIds.length === 0) return [];
  const supabase = createAdminClient();
  type C = { season_number: number; zone_id: number; external_guild_id: number; character_id: number; character_name: string; total_level: number | null; kills: number; experience: number };
  const rows = await fetchAll<C>((f, t) => {
    let q = supabase.from('assault_season_contributions').select('*').in('external_guild_id', trackedIds);
    if (opts.season) q = q.eq('season_number', opts.season);
    return q.range(f, t);
  });
  const byChar = new Map<number, TopAssaulter>();
  for (const r of rows) {
    const cur = byChar.get(r.character_id);
    if (cur) {
      cur.kills += Number(r.kills); cur.experience += Number(r.experience); cur.zones += 1;
      if ((r.total_level ?? 0) > (cur.total_level ?? 0)) cur.total_level = r.total_level;
    } else {
      byChar.set(r.character_id, {
        character_id: r.character_id, character_name: r.character_name, total_level: r.total_level,
        guild_id: r.external_guild_id, kills: Number(r.kills), experience: Number(r.experience), zones: 1,
      });
    }
  }
  return Array.from(byChar.values()).sort((a, b) => b.experience - a.experience).slice(0, opts.limit ?? 25);
}


// ---------------------------------------------------------------------------
// Member leaderboard (season or all-time), optionally merged by account (main + alts)
// ---------------------------------------------------------------------------

export interface LeaderboardRow {
  key: string;
  name: string;
  total_level: number | null;
  guild_id: number;
  guild_name: string;
  kills: number;
  experience: number;
  zones: number;
  seasons: number;
  alt_count: number;
  alt_names: string[];
}

export async function getAssaultLeaderboard(opts: {
  season?: number;
  guildId?: number;
  merged?: boolean;
  limit?: number;
}): Promise<{ rows: LeaderboardRow[]; guilds: Array<{ id: number; name: string }> }> {
  const supabase = createAdminClient();
  const tracked = await getTrackedExternalIds();
  if (tracked.length === 0) return { rows: [], guilds: [] };

  // guild names from standings (latest row per guild)
  const { data: nameRows } = await supabase
    .from('assault_zone_standings')
    .select('external_guild_id, guild_name')
    .in('external_guild_id', tracked)
    .limit(500);
  const names = new Map<number, string>();
  for (const r of (nameRows ?? []) as { external_guild_id: number; guild_name: string }[]) names.set(r.external_guild_id, r.guild_name);
  const guilds = tracked.map(id => ({ id, name: names.get(id) ?? `Guild ${id}` }));

  type C = { season_number: number; zone_id: number; external_guild_id: number; character_id: number; character_name: string; total_level: number | null; kills: number; experience: number };
  const ids = opts.guildId ? tracked.filter(t => t === opts.guildId) : tracked;
  const rows = await fetchAll<C>((f, t) => {
    let q = supabase.from('assault_season_contributions').select('*').in('external_guild_id', ids);
    if (opts.season) q = q.eq('season_number', opts.season);
    return q.range(f, t);
  });

  interface Agg { character_id: number; name: string; level: number | null; kills: number; xp: number; zones: number; seasons: Set<number>; byGuild: Map<number, number> }
  const byChar = new Map<number, Agg>();
  for (const r of rows) {
    const a = byChar.get(r.character_id) ?? { character_id: r.character_id, name: r.character_name, level: r.total_level, kills: 0, xp: 0, zones: 0, seasons: new Set<number>(), byGuild: new Map<number, number>() };
    a.kills += Number(r.kills); a.xp += Number(r.experience); a.zones += 1; a.seasons.add(r.season_number);
    if ((r.total_level ?? 0) > (a.level ?? 0)) { a.level = r.total_level; a.name = r.character_name; }
    a.byGuild.set(r.external_guild_id, (a.byGuild.get(r.external_guild_id) ?? 0) + Number(r.experience));
    byChar.set(r.character_id, a);
  }
  const topGuild = (a: Agg) => Array.from(a.byGuild.entries()).sort((x, y) => y[1] - x[1])[0]?.[0] ?? 0;

  let out: LeaderboardRow[];
  if (!opts.merged) {
    out = Array.from(byChar.values()).map(a => ({
      key: String(a.character_id), name: a.name, total_level: a.level, guild_id: topGuild(a), guild_name: names.get(topGuild(a)) ?? '',
      kills: a.kills, experience: a.xp, zones: a.zones, seasons: a.seasons.size, alt_count: 0, alt_names: [],
    }));
  } else {
    // character_id -> members.id -> main (via member_alts)
    const charIds = Array.from(byChar.keys());
    const memberByChar = new Map<number, { id: string; ign: string }>();
    for (let i = 0; i < charIds.length; i += 200) {
      const { data } = await supabase.from('members').select('id, ign, character_id').in('character_id', charIds.slice(i, i + 200));
      for (const m of (data ?? []) as { id: string; ign: string; character_id: number }[]) memberByChar.set(m.character_id, { id: m.id, ign: m.ign });
    }
    const memberIds = Array.from(memberByChar.values()).map(m => m.id);
    const mainOf = new Map<string, string>(); // alt member id -> main member id
    for (let i = 0; i < memberIds.length; i += 200) {
      const { data } = await supabase.from('member_alts').select('member_id, alt_member_id').in('alt_member_id', memberIds.slice(i, i + 200));
      for (const r of (data ?? []) as { member_id: string; alt_member_id: string | null }[]) if (r.alt_member_id) mainOf.set(r.alt_member_id, r.member_id);
    }
    const mainIds = Array.from(new Set(mainOf.values()));
    const mainIgn = new Map<string, string>();
    for (let i = 0; i < mainIds.length; i += 200) {
      const { data } = await supabase.from('members').select('id, ign').in('id', mainIds.slice(i, i + 200));
      for (const m of (data ?? []) as { id: string; ign: string }[]) mainIgn.set(m.id, m.ign);
    }
    const groups = new Map<string, { name: string; level: number | null; kills: number; xp: number; zones: number; seasons: Set<number>; byGuild: Map<number, number>; alts: string[] }>();
    for (const a of Array.from(byChar.values())) {
      const mem = memberByChar.get(a.character_id);
      const groupKey = mem ? (mainOf.get(mem.id) ?? mem.id) : `c${a.character_id}`;
      const groupName = mem ? (mainIgn.get(mainOf.get(mem.id) ?? '') ?? mem.ign) : a.name;
      const g = groups.get(groupKey) ?? { name: groupName, level: a.level, kills: 0, xp: 0, zones: 0, seasons: new Set<number>(), byGuild: new Map<number, number>(), alts: [] };
      g.kills += a.kills; g.xp += a.xp; g.zones += a.zones;
      a.seasons.forEach(s => g.seasons.add(s));
      a.byGuild.forEach((v, k) => g.byGuild.set(k, (g.byGuild.get(k) ?? 0) + v));
      if ((a.level ?? 0) > (g.level ?? 0)) g.level = a.level;
      if (a.name !== groupName) g.alts.push(a.name);
      groups.set(groupKey, g);
    }
    out = Array.from(groups.entries()).map(([key, g]) => {
      const tg = Array.from(g.byGuild.entries()).sort((x, y) => y[1] - x[1])[0]?.[0] ?? 0;
      return { key, name: g.name, total_level: g.level, guild_id: tg, guild_name: names.get(tg) ?? '', kills: g.kills, experience: g.xp, zones: g.zones, seasons: g.seasons.size, alt_count: g.alts.length, alt_names: g.alts };
    });
  }

  out.sort((a, b) => b.experience - a.experience);
  return { rows: out.slice(0, opts.limit ?? 200), guilds };
}


// ---------------------------------------------------------------------------
// All zones: full guild ranking per location for a season
// ---------------------------------------------------------------------------

export interface ZoneRanking {
  zone_id: number; zone_name: string; image_url: string | null; guild_count: number;
  guilds: FieldEntry[];
}

export async function getSeasonZones(season: number, trackedIds: number[]): Promise<ZoneRanking[]> {
  const supabase = createAdminClient();
  const rows = await fetchAll<StandingRow>((f, t) =>
    supabase.from('assault_zone_standings').select('*').eq('season_number', season).range(f, t));
  const meta = await getLocationMeta().catch(() => new Map());
  const { data: dg } = await supabase.from('guilds').select('id');
  const dreamIds = new Set(((dg ?? []) as { id: string }[]).map(g => parseInt(g.id, 10)).filter(n => !Number.isNaN(n)));
  const byZone = new Map<number, StandingRow[]>();
  for (const r of rows) byZone.set(r.zone_id, [...(byZone.get(r.zone_id) ?? []), r]);
  return Array.from(byZone.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([zone_id, zr]) => ({
      zone_id,
      zone_name: zr[0].zone_name,
      image_url: meta.get(zone_id)?.image_url ?? null,
      guild_count: zr.length,
      guilds: zr.sort((a, b) => a.position - b.position).map(r => ({
        position: r.position, guild_id: r.external_guild_id, name: r.guild_name, tag: r.guild_tag,
        experience: Number(r.experience), kills: Number(r.kills), ours: trackedIds.includes(r.external_guild_id),
        dream: dreamIds.has(r.external_guild_id),
      })),
    }));
}
