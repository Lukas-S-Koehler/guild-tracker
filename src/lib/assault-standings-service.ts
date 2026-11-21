import { createAdminClient } from '@/lib/supabase-server';
import { IdleMMOApi, type ConquestZone } from '@/lib/idlemmo-api';

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

export interface SeasonOverview {
  season: number;
  seasons: number[];
  guilds: Array<{
    guild_id: number; guild_name: string; guild_tag: string | null;
    overall_rank: number | null; of: number; experience: number; kills: number;
    zones: Array<{ zone_id: number; zone_name: string; position: number; of: number; kills: number; experience: number; leader: { name: string; experience: number } | null }>;
  }>;
  snapshot_at: string | null;
}

export async function listStandingSeasons(): Promise<number[]> {
  const supabase = createAdminClient();
  const rows = await fetchAll<{ season_number: number }>((f, t) =>
    supabase.from('assault_zone_standings').select('season_number').range(f, t));
  return Array.from(new Set(rows.map(r => r.season_number))).sort((a, b) => b - a);
}

export async function getTrackedExternalIds(): Promise<number[]> {
  const supabase = createAdminClient();
  const { data } = await supabase.from('assault_configs').select('external_guild_id').not('external_guild_id', 'is', null);
  return Array.from(new Set(((data ?? []) as { external_guild_id: number }[]).map(r => r.external_guild_id)));
}

export async function getSeasonOverview(season: number, trackedIds: number[]): Promise<SeasonOverview> {
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

  const guilds = trackedIds.map(gid => {
    const mine = rows.filter(r => r.external_guild_id === gid);
    const rank = ranked.indexOf(gid);
    const t = totals.get(gid);
    return {
      guild_id: gid,
      guild_name: mine[0]?.guild_name ?? `Guild ${gid}`,
      guild_tag: mine[0]?.guild_tag ?? null,
      overall_rank: rank >= 0 ? rank + 1 : null,
      of: ranked.length,
      experience: t?.xp ?? 0,
      kills: t?.kills ?? 0,
      zones: mine
        .map(m => {
          const leader = rows.filter(r => r.zone_id === m.zone_id).sort((a, b) => a.position - b.position)[0];
          return {
            zone_id: m.zone_id, zone_name: m.zone_name, position: m.position, of: m.zone_guild_count,
            kills: Number(m.kills), experience: Number(m.experience),
            leader: leader && leader.external_guild_id !== gid ? { name: leader.guild_name, experience: Number(leader.experience) } : null,
          };
        })
        .sort((a, b) => a.position - b.position || b.experience - a.experience),
    };
  });

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
  return Array.from(best.values())
    .map(r => ({
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
