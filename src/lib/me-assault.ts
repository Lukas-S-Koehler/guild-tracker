/**
 * Personal assault page (Dream Hub step 10, C1–C4): /me/assault, /api/me/assault, Discord `/assault me`.
 *
 * Whole account (all claimed characters + alts). Sources:
 *  - assault_season_contributions: season-cumulative per character per zone (authoritative totals, ranks).
 *  - assault_runs + assault_contributions: per-wave deltas (waves, attendance, best wave).
 *  - assault_zone_standings: the guild's position per zone.
 * In-game shard leaderboards rank every player in a zone; we only see Dream guilds, so ranks here are
 * "in your guild" and "among Dream players", never a shard projection (user decision 2026-11-23).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAccountCharacters } from '@/lib/account-service';
import { getAssaultLeaderboard, getCurrentSeason, getDreamExternalIds } from '@/lib/assault-standings-service';
import { getLocationMeta } from '@/lib/world-locations';
import { isAssaultDay, nextAssaultLaunchUnix, type AssaultConfig } from '@/lib/assault-service';
import { computeLaunchDate } from '@/lib/assault-checklist-service';

export interface AssaultRank {
  rank: number;
  of: number;
  experience: number;
  kills: number;
}

export interface ZoneCharRow {
  ign: string;
  experience: number;
  kills: number;
  /** Position among the members of the same guild in this zone (by EXP / kills). */
  guild_rank_xp: number;
  guild_rank_kills: number;
  guild_size: number;
  /** Position among every Dream player in this zone (by EXP). */
  dream_rank_xp: number;
  dream_of: number;
}

export interface ZoneBlock {
  zone_id: number;
  zone_name: string;
  image_url: string | null;
  guild_external_id: number;
  guild_name: string;
  /** Guild's place in the zone this season (territory boost if ≤ 10). */
  guild_position: number | null;
  guild_of: number | null;
  experience: number;
  kills: number;
  characters: ZoneCharRow[];
}

export interface WaveRow {
  run_id: string;
  guild_id: string;
  guild_name: string;
  zone_name: string;
  wave: number;
  starts_at: string;
  status: string;
  attended: boolean;
  experience: number;
  kills: number;
  /** Your share of the wave's guild XP, 0–100. */
  share_pct: number;
  /** Your best character's place in the wave by XP. */
  rank: number | null;
  participants: number;
  characters: string[];
}

export interface AssaultGuildInfo {
  guild_id: string;
  name: string;
  nickname: string | null;
  zone_name: string | null;
  active: boolean;
  next_launch_unix: number | null;
  season_end: string | null;
  checklist: { launch_date: string; done: number; total: number } | null;
}

export interface PotionPin {
  name: string;
  combat: { name: string; image_url: string | null }[];
  xp: { name: string; image_url: string | null }[];
}

export interface SetupPin {
  id: string;
  name: string;
  ign: string | null;
  zone_name: string | null;
  enemy_name: string | null;
  pet: string | null;
  gear_mode: 'mine' | 'sandbox';
  updated_at: string;
}

export interface MeAssault {
  claimed: boolean;
  current_season: number;
  season: number;
  /** Seasons you have data in (newest first), always includes the current season. */
  seasons: number[];
  /** Season is over (older than the current one). */
  finished: boolean;
  totals: { experience: number; kills: number; zones: number; characters: number };
  attendance: { attended: number; waves: number };
  ranks: { season: AssaultRank | null; all_time: AssaultRank | null };
  zones: ZoneBlock[];
  waves: WaveRow[];
  best_wave: WaveRow | null;
  guilds: AssaultGuildInfo[];
  loadout: { potions: PotionPin | null; setup: SetupPin | null };
}

interface SeasonRow {
  season_number: number;
  zone_id: number;
  external_guild_id: number;
  character_id: number;
  character_hashed_id: string | null;
  character_name: string;
  kills: number;
  experience: number;
}

interface RunRow {
  id: string;
  guild_id: string;
  zone_id: number;
  zone_name: string;
  season_number: number | null;
  starts_at: string;
  status: string;
  total_kills: number;
  total_experience: number;
}

interface ContribRow {
  run_id: string;
  character_id: number;
  character_hashed_id: string | null;
  character_name: string;
  kills: number;
  experience: number;
}

async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message);
    const rows = (data as T[]) ?? [];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

const empty = (season: number, current: number): MeAssault => ({
  claimed: false,
  current_season: current,
  season,
  seasons: [current],
  finished: season < current,
  totals: { experience: 0, kills: 0, zones: 0, characters: 0 },
  attendance: { attended: 0, waves: 0 },
  ranks: { season: null, all_time: null },
  zones: [],
  waves: [],
  best_wave: null,
  guilds: [],
  loadout: { potions: null, setup: null },
});

/** Rank of the account's merged leaderboard entry (all its characters) against everyone else's. */
async function accountRank(memberIds: Set<string>, season?: number): Promise<AssaultRank | null> {
  const { rows } = await getAssaultLeaderboard({ season, merged: true, limit: 100000 });
  const mine = rows.filter((r) => memberIds.has(r.key));
  const xp = mine.reduce((s, r) => s + r.experience, 0);
  if (xp <= 0) return null;
  const others = rows.filter((r) => !memberIds.has(r.key));
  return {
    rank: 1 + others.filter((r) => r.experience > xp).length,
    of: others.length + 1,
    experience: xp,
    kills: mine.reduce((s, r) => s + r.kills, 0),
  };
}

/** 1-based rank of `value` among `values` (higher is better, ties share). */
const rankIn = (value: number, values: number[]) => 1 + values.filter((v) => v > value).length;

export async function buildMeAssault(
  userId: string,
  supabase: SupabaseClient,
  opts: { season?: number; skipRanks?: boolean } = {}
): Promise<MeAssault> {
  const current = await getCurrentSeason();
  const season = opts.season && opts.season > 0 ? opts.season : current;
  const characters = await getAccountCharacters(userId, supabase);
  if (characters.length === 0) return empty(season, current);

  const memberIds = new Set(characters.map((c) => c.member_id));
  const { data: memberRows } = await supabase.from('members').select('id, ign, character_id, hashed_id').in('id', Array.from(memberIds));
  const charIds = new Set<number>();
  const hashes = new Set<string>();
  for (const m of (memberRows ?? []) as { id: string; character_id: number | null; hashed_id: string | null }[]) {
    if (m.character_id) charIds.add(m.character_id);
    if (m.hashed_id) hashes.add(m.hashed_id);
  }
  const isMine = (r: { character_id: number; character_hashed_id: string | null }) =>
    charIds.has(r.character_id) || (!!r.character_hashed_id && hashes.has(r.character_hashed_id));

  // ── Season contributions (yours, all seasons → season list; then the zones you fought in this season)
  const orFilter = [
    charIds.size ? `character_id.in.(${Array.from(charIds).join(',')})` : null,
    hashes.size ? `character_hashed_id.in.(${Array.from(hashes).map((h) => `"${h}"`).join(',')})` : null,
  ].filter(Boolean).join(',');
  const myAll: SeasonRow[] = orFilter
    ? await fetchAll<SeasonRow>((f, t) =>
        supabase.from('assault_season_contributions')
          .select('season_number, zone_id, external_guild_id, character_id, character_hashed_id, character_name, kills, experience')
          .or(orFilter).range(f, t))
    : [];
  const seasons = Array.from(new Set([current, ...myAll.map((r) => r.season_number)])).sort((a, b) => b - a);
  const mySeason = myAll.filter((r) => r.season_number === season && (Number(r.experience) > 0 || Number(r.kills) > 0));

  const zoneIds = Array.from(new Set(mySeason.map((r) => r.zone_id)));
  const dreamIds = await getDreamExternalIds();
  const [field, standings, meta] = await Promise.all([
    zoneIds.length
      ? fetchAll<SeasonRow>((f, t) =>
          supabase.from('assault_season_contributions')
            .select('season_number, zone_id, external_guild_id, character_id, character_hashed_id, character_name, kills, experience')
            .eq('season_number', season).in('zone_id', zoneIds).in('external_guild_id', dreamIds).range(f, t))
      : Promise.resolve([] as SeasonRow[]),
    zoneIds.length
      ? supabase.from('assault_zone_standings').select('zone_id, zone_name, external_guild_id, guild_name, position, zone_guild_count')
          .eq('season_number', season).in('zone_id', zoneIds)
          .then((r) => (r.data ?? []) as { zone_id: number; zone_name: string; external_guild_id: number; guild_name: string; position: number; zone_guild_count: number }[])
      : Promise.resolve([]),
    getLocationMeta().catch(() => new Map()),
  ]);

  const zoneMap = new Map<string, ZoneBlock>();
  for (const r of mySeason) {
    const key = `${r.zone_id}|${r.external_guild_id}`;
    const st = standings.find((s) => s.zone_id === r.zone_id && s.external_guild_id === r.external_guild_id);
    const z = zoneMap.get(key) ?? {
      zone_id: r.zone_id,
      zone_name: st?.zone_name ?? standings.find((s) => s.zone_id === r.zone_id)?.zone_name ?? `Zone ${r.zone_id}`,
      image_url: (meta.get(r.zone_id) as { image_url?: string | null } | undefined)?.image_url ?? null,
      guild_external_id: r.external_guild_id,
      guild_name: st?.guild_name ?? '',
      guild_position: st?.position ?? null,
      guild_of: st?.zone_guild_count ?? null,
      experience: 0,
      kills: 0,
      characters: [],
    };
    const inZone = field.filter((f) => f.zone_id === r.zone_id);
    const inGuild = inZone.filter((f) => f.external_guild_id === r.external_guild_id);
    const xp = Number(r.experience);
    const kills = Number(r.kills);
    z.experience += xp;
    z.kills += kills;
    z.characters.push({
      ign: r.character_name,
      experience: xp,
      kills,
      guild_rank_xp: rankIn(xp, inGuild.filter((f) => f.character_id !== r.character_id).map((f) => Number(f.experience))),
      guild_rank_kills: rankIn(kills, inGuild.filter((f) => f.character_id !== r.character_id).map((f) => Number(f.kills))),
      guild_size: Math.max(inGuild.filter((f) => Number(f.experience) > 0).length, 1),
      dream_rank_xp: rankIn(xp, inZone.filter((f) => !(f.character_id === r.character_id && f.external_guild_id === r.external_guild_id)).map((f) => Number(f.experience))),
      dream_of: Math.max(inZone.filter((f) => Number(f.experience) > 0).length, 1),
    });
    zoneMap.set(key, z);
  }
  const zones = Array.from(zoneMap.values())
    .map((z) => ({ ...z, characters: z.characters.sort((a, b) => b.experience - a.experience) }))
    .sort((a, b) => b.experience - a.experience);

  // ── Waves: every run this season of the guilds you fought for (or are in now, if an assault guild)
  const { data: guildRows } = await supabase.from('guilds').select('id, name, nickname, is_assault');
  const guildInfo = new Map(((guildRows ?? []) as { id: string; name: string; nickname: string | null; is_assault: boolean | null }[]).map((g) => [g.id, g]));
  const fightGuilds = new Set<string>(mySeason.map((r) => String(r.external_guild_id)));
  for (const c of characters) if (c.guild_id && guildInfo.get(c.guild_id)?.is_assault) fightGuilds.add(c.guild_id);

  const runs: RunRow[] = fightGuilds.size
    ? await fetchAll<RunRow>((f, t) =>
        supabase.from('assault_runs')
          .select('id, guild_id, zone_id, zone_name, season_number, starts_at, status, total_kills, total_experience')
          .eq('season_number', season).in('guild_id', Array.from(fightGuilds)).order('starts_at').range(f, t))
    : [];
  const contribs: ContribRow[] = runs.length
    ? await fetchAll<ContribRow>((f, t) =>
        supabase.from('assault_contributions')
          .select('run_id, character_id, character_hashed_id, character_name, kills, experience')
          .in('run_id', runs.map((r) => r.id)).range(f, t))
    : [];
  const byRun = new Map<string, ContribRow[]>();
  for (const c of contribs) byRun.set(c.run_id, [...(byRun.get(c.run_id) ?? []), c]);

  // Wave number per (guild, zone) in start order.
  const counter = new Map<string, number>();
  const allWaves: WaveRow[] = runs.map((run) => {
    const k = `${run.guild_id}|${run.zone_id}`;
    const wave = (counter.get(k) ?? 0) + 1;
    counter.set(k, wave);
    const rows = byRun.get(run.id) ?? [];
    const mine = rows.filter(isMine);
    const xp = mine.reduce((s, r) => s + Number(r.experience), 0);
    const kills = mine.reduce((s, r) => s + Number(r.kills), 0);
    const total = Number(run.total_experience) || rows.reduce((s, r) => s + Number(r.experience), 0);
    const bestMine = Math.max(0, ...mine.map((r) => Number(r.experience)));
    const g = guildInfo.get(run.guild_id);
    return {
      run_id: run.id,
      guild_id: run.guild_id,
      guild_name: g?.nickname ?? g?.name ?? run.guild_id,
      zone_name: run.zone_name,
      wave,
      starts_at: run.starts_at,
      status: run.status,
      attended: xp > 0 || kills > 0,
      experience: xp,
      kills,
      share_pct: total > 0 ? Math.round((xp / total) * 1000) / 10 : 0,
      rank: mine.length ? rankIn(bestMine, rows.filter((r) => !isMine(r)).map((r) => Number(r.experience))) : null,
      participants: rows.filter((r) => Number(r.experience) > 0).length,
      characters: mine.map((r) => r.character_name),
    };
  });
  // Attendance counts only from your first wave in each guild this season (joining mid-season isn't "missing").
  const firstIn = new Map<string, string>();
  for (const w of allWaves) if (w.attended && !firstIn.has(w.guild_id)) firstIn.set(w.guild_id, w.starts_at);
  const counted = allWaves.filter((w) => firstIn.has(w.guild_id) && w.starts_at >= firstIn.get(w.guild_id)! && w.status === 'finalized');
  const waves = allWaves.filter((w) => !firstIn.has(w.guild_id) || w.starts_at >= firstIn.get(w.guild_id)!).reverse();
  const best = allWaves.filter((w) => w.attended).sort((a, b) => b.experience - a.experience)[0] ?? null;

  // ── Assault guilds you're in now: next launch + checklist progress
  const guilds: AssaultGuildInfo[] = [];
  const nowIn = Array.from(new Set(characters.filter((c) => c.guild_id && guildInfo.get(c.guild_id)?.is_assault).map((c) => c.guild_id!)));
  if (nowIn.length) {
    const [{ data: cfgs }, { count: templateCount }, { data: link }] = await Promise.all([
      supabase.from('assault_configs').select('*').in('guild_id', nowIn),
      supabase.from('assault_checklist_template').select('item_key', { count: 'exact', head: true }).eq('enabled', true),
      supabase.from('user_discord_links').select('discord_id').eq('user_id', userId).maybeSingle(),
    ]);
    for (const gid of nowIn) {
      const cfg = ((cfgs ?? []) as AssaultConfig[]).find((c) => c.guild_id === gid) ?? null;
      const g = guildInfo.get(gid)!;
      let checklist: AssaultGuildInfo['checklist'] = null;
      if (cfg) {
        const launchDate = computeLaunchDate(cfg.launch_time_utc ?? '18:00:00');
        const [{ data: web }, { data: dc }] = await Promise.all([
          supabase.from('assault_checklist_progress').select('item_key').eq('user_id', userId).eq('guild_id', gid).eq('launch_date', launchDate),
          link?.discord_id
            ? supabase.from('assault_checklist_discord_state').select('item_key').eq('discord_user_id', link.discord_id).eq('launch_date', launchDate)
            : Promise.resolve({ data: [] }),
        ]);
        const done = new Set([...(web ?? []), ...(dc ?? [])].map((r: { item_key: string }) => r.item_key));
        // The checklist is filed under the most recent daily launch moment. It's live while that launch's
        // assault runs (9h), and counts for the next launch from the day before it. Otherwise it's stale.
        const next = nextAssaultLaunchUnix(cfg);
        const dayBeforeNext = next ? new Date((next - 86_400) * 1000).toISOString().slice(0, 10) : null;
        const launchMoment = new Date(`${launchDate}T${(cfg.launch_time_utc ?? '18:00:00').slice(0, 8)}Z`).getTime();
        const running = isAssaultDay({ ...cfg, active: true }, new Date(launchMoment)) && Date.now() < launchMoment + 9 * 3_600_000;
        const current = running || (!!dayBeforeNext && launchDate >= dayBeforeNext);
        checklist = { launch_date: launchDate, done: current ? done.size : 0, total: templateCount ?? 0 };
      }
      guilds.push({
        guild_id: gid,
        name: g.name,
        nickname: g.nickname,
        zone_name: cfg?.zone_name ?? null,
        active: !!cfg?.active,
        next_launch_unix: cfg ? nextAssaultLaunchUnix(cfg) : null,
        season_end: cfg?.season_end ?? null,
        checklist,
      });
    }
  }

  const [ranks, loadout] = await Promise.all([
    opts.skipRanks
      ? Promise.resolve({ season: null, all_time: null })
      : Promise.all([accountRank(memberIds, season), accountRank(memberIds)]).then(([s, a]) => ({ season: s, all_time: a })),
    pinnedLoadout(userId, supabase),
  ]);

  return {
    claimed: true,
    current_season: current,
    season,
    seasons,
    finished: season < current,
    totals: {
      experience: mySeason.reduce((s, r) => s + Number(r.experience), 0),
      kills: mySeason.reduce((s, r) => s + Number(r.kills), 0),
      zones: zoneIds.length,
      characters: new Set(mySeason.map((r) => r.character_id)).size,
    },
    attendance: { attended: counted.filter((w) => w.attended).length, waves: counted.length },
    ranks,
    zones,
    waves,
    best_wave: best,
    guilds,
    loadout,
  };
}

/** Default potion loadout (web or Discord) + the pinned /combat setup. */
export async function pinnedLoadout(userId: string, supabase: SupabaseClient): Promise<MeAssault['loadout']> {
  const { data: link } = await supabase.from('user_discord_links').select('discord_id').eq('user_id', userId).maybeSingle();
  type L = { name: string; combat_potion_ids: number[] | null; xp_potion_ids: number[] | null; user_id: string | null };
  const q = supabase.from('assault_potion_loadouts').select('name, combat_potion_ids, xp_potion_ids, user_id').eq('is_default', true);
  const { data: lds } = await (link?.discord_id ? q.or(`user_id.eq.${userId},discord_user_id.eq.${link.discord_id}`) : q.eq('user_id', userId));
  const ld = ((lds ?? []) as L[]).sort((a, b) => Number(b.user_id === userId) - Number(a.user_id === userId))[0] ?? null;

  let potions: PotionPin | null = null;
  if (ld) {
    const [{ data: cp }, { data: xp }] = await Promise.all([
      ld.combat_potion_ids?.length ? supabase.from('combat_potions').select('id, name, image_url').in('id', ld.combat_potion_ids) : Promise.resolve({ data: [] }),
      ld.xp_potion_ids?.length ? supabase.from('xp_potions').select('id, name, image_url').in('id', ld.xp_potion_ids) : Promise.resolve({ data: [] }),
    ]);
    const pick = (rows: unknown) => ((rows ?? []) as { name: string; image_url: string | null }[]).map((r) => ({ name: r.name, image_url: r.image_url }));
    potions = { name: ld.name, combat: pick(cp), xp: pick(xp) };
  }

  // `pinned` comes with database/assault-personal.sql; before that the query errors and nothing is pinned.
  let setup: SetupPin | null = null;
  const { data: s, error } = await supabase
    .from('combat_setups')
    .select('id, name, data, updated_at, profile:combat_profiles(ign)')
    .eq('user_id', userId)
    .eq('pinned', true)
    .maybeSingle();
  if (!error && s) {
    const d = (s.data ?? {}) as { target?: { zoneId?: number | null; enemyId?: number | null }; pet?: { species?: string | null; mode?: string }; gearMode?: 'mine' | 'sandbox' };
    const { data: enemy } = d.target?.enemyId
      ? await supabase.from('combat_enemies').select('name, zone_name').eq('id', d.target.enemyId).maybeSingle()
      : { data: null };
    const profile = Array.isArray(s.profile) ? s.profile[0] : s.profile;
    setup = {
      id: s.id as string,
      name: s.name as string,
      ign: (profile as { ign?: string } | null)?.ign ?? null,
      zone_name: (enemy as { zone_name?: string } | null)?.zone_name ?? null,
      enemy_name: (enemy as { name?: string } | null)?.name ?? null,
      pet: d.pet?.mode === 'sandbox' ? d.pet.species ?? null : 'equipped pet',
      gear_mode: d.gearMode ?? 'mine',
      updated_at: s.updated_at as string,
    };
  }
  return { potions, setup };
}
