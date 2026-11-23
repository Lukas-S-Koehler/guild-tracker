/**
 * Achievement evaluator (Dream Hub step 9). Computes every metric in src/lib/achievements.ts per
 * ACCOUNT (main + alts, full member_alts closure) from data we already store, in bulk.
 *
 * Each metric also knows WHEN a threshold was crossed (from dated history), so the launch backfill
 * records real unlock dates. Metrics without history (levels, claims) unlock "now".
 *
 *  - runAchievements(): daily cron. Writes new unlocks for every character of the account.
 *    First run = silent backfill (no announcements). Then the #hall-of-fame digest (Silver+).
 *  - accountProgress(): one account, for /me and the Discord /me command.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { ACHIEVEMENTS, ACHIEVEMENT_BY_KEY, TIERS, grantsTitle, type Achievement, type Metric } from '@/lib/achievements';
import { getAccountKeys } from '@/lib/alt-graph';
import { getISOWeekKey, getWeekSunday } from '@/lib/warning-calculator';
import { ASSAULT_ENTRY_GUILD_ID, ASSAULT_TOP_GUILD_ID } from '@/lib/raids';

const DAY = 86_400_000;
const FOUNDER_BEFORE = '2026-06-01';
const TOP_RAID_CL = 92;
const PAGE = 1000;

const dateOf = (iso: string) => iso.slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
/** Game day of an event timestamp (boundary 11:50 UTC). */
const gameDay = (iso: string) => new Date(Date.parse(iso) - (11 * 60 + 50) * 60_000).toISOString().slice(0, 10);
/** Last completed game day = yesterday (UTC calendar), like the activity check. */
const lastGameDay = () => addDays(new Date().toISOString().slice(0, 10), -1);

async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

const chunks = <T,>(arr: T[], n = 200): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

// ─── Metric values with crossing dates ───────────────────────────────────────

export interface MetricValue {
  value: number;
  /** Date (YYYY-MM-DD) the value first reached `threshold`, or null when unknown (→ now). */
  at: (threshold: number) => string | null;
}

/** Cumulative series from dated increments. */
function series(points: Array<{ date: string; inc: number }>): MetricValue {
  const sorted = points.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const value = sorted.reduce((s, p) => s + p.inc, 0);
  return {
    value,
    at: (t) => {
      let sum = 0;
      for (const p of sorted) {
        sum += p.inc;
        if (sum >= t) return p.date;
      }
      return null;
    },
  };
}

const flag = (date: string | null | undefined, on = !!date): MetricValue => ({ value: on ? 1 : 0, at: () => date ?? null });
const plain = (value: number): MetricValue => ({ value, at: () => null });

// ─── Data ────────────────────────────────────────────────────────────────────

interface MemberRow {
  id: string;
  ign: string;
  hashed_id: string | null;
  discord_id: string | null;
  character_id: number | null;
  combat_level: number | null;
  total_level: number | null;
  first_seen: string | null;
  current_guild_id: string | null;
  is_active: boolean | null;
}
interface LogRow { member_id: string; log_date: string; raids: number | null; gold_donated: number | null; deposits_gold: number | null; met_requirement: boolean | null; guild_id: string | null }
interface EventRow { type: string; guild_id: string; character_hashed_id: string; item_hashed_id: string | null; created_at: string }
interface AssaultRow { season_number: number; external_guild_id: string; character_hashed_id: string; experience: number | null; snapshot_at: string }
interface AwayRow { member_ids: string[]; starts_on: string; ends_on: string; ended_at: string | null }
interface GuildRow { id: string; min_level: number | null; is_assault: boolean | null }

export interface Account {
  key: string;
  memberIds: string[];
  members: MemberRow[];
  /** Display character: the oldest active Dream character, else the oldest one. */
  main: MemberRow;
  discordIds: string[];
  userIds: string[];
}

interface Context {
  today: string;
  logs: Map<string, LogRow[]>; // member_id → logs
  events: Map<string, EventRow[]>; // member_id → events
  assault: AssaultRow[];
  bumps: Array<{ discord_id: string | null; member_id: string | null; bumped_at: string }>;
  away: AwayRow[];
  guilds: Map<string, GuildRow>;
  claims: Array<{ user_id: string; member_id: string; reviewed_at: string | null; requested_at: string | null }>;
  links: Map<string, { discord_id: string; linked_at: string }>; // user_id → link
  /** Only in full runs (need every account): account key → first week date won. */
  topDonorWeek?: Map<string, string>;
  networkWeek1?: Map<string, string>;
}

const MEMBER_COLS = 'id, ign, hashed_id, discord_id, character_id, combat_level, total_level, first_seen, current_guild_id, is_active';

function pickMain(members: MemberRow[]): MemberRow {
  const byAge = members.slice().sort((a, b) => (a.character_id ?? Infinity) - (b.character_id ?? Infinity));
  return byAge.find((m) => m.is_active !== false && m.current_guild_id) ?? byAge[0]!;
}

async function loadContext(supabase: SupabaseClient, members: MemberRow[], full: boolean): Promise<Context> {
  const ids = members.map((m) => m.id);
  const hashes = members.map((m) => m.hashed_id).filter(Boolean) as string[];
  const hashToMember = new Map(members.filter((m) => m.hashed_id).map((m) => [m.hashed_id as string, m.id]));

  const logCols = 'member_id, log_date, raids, gold_donated, deposits_gold, met_requirement, guild_id';
  const evCols = 'type, guild_id, character_hashed_id, item_hashed_id, created_at';
  const evTypes = ['CHALLENGE_CONTRIBUTION', 'DEPOSITED_STOCKPILE', 'ACTIVATED_ENERGIZING_POOL'];

  const loadLogs = full
    ? fetchAll<LogRow>((f, t) => supabase.from('daily_logs').select(logCols).order('id').range(f, t))
    : Promise.all(chunks(ids).map((c) => fetchAll<LogRow>((f, t) => supabase.from('daily_logs').select(logCols).in('member_id', c).order('id').range(f, t)))).then((r) => r.flat());
  const loadEvents = full
    ? fetchAll<EventRow>((f, t) => supabase.from('guild_activity_events').select(evCols).in('type', evTypes).order('id').range(f, t))
    : hashes.length
      ? fetchAll<EventRow>((f, t) => supabase.from('guild_activity_events').select(evCols).in('type', evTypes).in('character_hashed_id', hashes).order('id').range(f, t))
      : Promise.resolve([] as EventRow[]);

  const [logs, events, assault, bumps, away, guilds, claims, links] = await Promise.all([
    loadLogs,
    loadEvents,
    fetchAll<AssaultRow>((f, t) => supabase.from('assault_season_contributions').select('season_number, external_guild_id, character_hashed_id, experience, snapshot_at').range(f, t)),
    fetchAll<{ discord_id: string | null; member_id: string | null; bumped_at: string }>((f, t) => supabase.from('bumps').select('discord_id, member_id, bumped_at').range(f, t)),
    fetchAll<AwayRow>((f, t) => supabase.from('away_periods').select('member_ids, starts_on, ends_on, ended_at').range(f, t)),
    supabase.from('guilds').select('id, min_level, is_assault').then((r) => (r.data ?? []) as GuildRow[]),
    fetchAll<{ user_id: string; member_id: string; reviewed_at: string | null; requested_at: string | null }>((f, t) =>
      supabase.from('user_characters').select('user_id, member_id, reviewed_at, requested_at').eq('status', 'approved').range(f, t)
    ),
    fetchAll<{ user_id: string; discord_id: string; linked_at: string }>((f, t) => supabase.from('user_discord_links').select('user_id, discord_id, linked_at').range(f, t)),
  ]);

  const idSet = new Set(ids);
  const logMap = new Map<string, LogRow[]>();
  for (const l of logs) {
    if (!idSet.has(l.member_id)) continue;
    const a = logMap.get(l.member_id) ?? [];
    a.push(l);
    logMap.set(l.member_id, a);
  }
  const evMap = new Map<string, EventRow[]>();
  for (const e of events) {
    const mid = hashToMember.get(e.character_hashed_id);
    if (!mid) continue;
    const a = evMap.get(mid) ?? [];
    a.push(e);
    evMap.set(mid, a);
  }

  return {
    today: lastGameDay(),
    logs: logMap,
    events: evMap,
    assault,
    bumps,
    away,
    guilds: new Map(guilds.map((g) => [g.id, g])),
    claims,
    links: new Map(links.map((l) => [l.user_id, { discord_id: l.discord_id, linked_at: l.linked_at }])),
  };
}

/** Weekly winners over completed ISO weeks: top donor per guild, #1 network activity score. */
function weeklyWinners(ctx: Context, accountOf: Map<string, string>) {
  const thisWeek = getISOWeekKey(addDays(ctx.today, 1));
  const guildWeek = new Map<string, Map<string, number>>(); // guild|week → account → gold
  const netWeek = new Map<string, Map<string, number>>(); // week → account → score
  for (const [mid, logs] of Array.from(ctx.logs)) {
    const acc = accountOf.get(mid);
    if (!acc) continue;
    for (const l of logs) {
      const wk = getISOWeekKey(l.log_date);
      if (wk >= thisWeek) continue;
      const gold = (l.gold_donated ?? 0) + (l.deposits_gold ?? 0);
      if (l.guild_id) {
        const gk = `${l.guild_id}|${wk}`;
        const m = guildWeek.get(gk) ?? new Map<string, number>();
        m.set(acc, (m.get(acc) ?? 0) + gold);
        guildWeek.set(gk, m);
      }
      const n = netWeek.get(wk) ?? new Map<string, number>();
      n.set(acc, (n.get(acc) ?? 0) + gold + (l.raids ?? 0) * 1000); // same score as /leaderboard
      netWeek.set(wk, n);
    }
  }
  const winners = (m: Map<string, Map<string, number>>, weekOf: (k: string) => string) => {
    const out = new Map<string, string>();
    for (const [k, scores] of Array.from(m)) {
      let best: string | null = null;
      let bestV = 0;
      for (const [acc, v] of Array.from(scores)) if (v > bestV) { best = acc; bestV = v; }
      if (!best) continue;
      const sunday = getWeekSunday(weekOf(k));
      const prev = out.get(best);
      if (!prev || sunday < prev) out.set(best, sunday);
    }
    return out;
  };
  ctx.topDonorWeek = winners(guildWeek, (k) => k.split('|')[1]!);
  ctx.networkWeek1 = winners(netWeek, (k) => k);
}

/** Assault: per account best season EXP, seasons played, top-10 / #1 of its guild in a finished season. */
function assaultFor(ctx: Context, hashes: Set<string>) {
  // Latest (max) EXP per character per season+guild.
  const best = new Map<string, { season: number; guild: string; hash: string; exp: number; at: string }>();
  let maxSeason = 0;
  for (const r of ctx.assault) {
    maxSeason = Math.max(maxSeason, r.season_number);
    const k = `${r.season_number}|${r.external_guild_id}|${r.character_hashed_id}`;
    const exp = r.experience ?? 0;
    const cur = best.get(k);
    if (!cur || exp > cur.exp) best.set(k, { season: r.season_number, guild: r.external_guild_id, hash: r.character_hashed_id, exp, at: dateOf(r.snapshot_at) });
  }
  const perSeason = new Map<number, { exp: number; at: string }>();
  let top10: string | null = null;
  let top1: string | null = null;
  const byGuildSeason = new Map<string, Array<{ hash: string; exp: number; at: string }>>();
  for (const v of Array.from(best.values())) {
    const gk = `${v.season}|${v.guild}`;
    const a = byGuildSeason.get(gk) ?? [];
    a.push(v);
    byGuildSeason.set(gk, a);
    if (!hashes.has(v.hash) || v.exp <= 0) continue;
    const s = perSeason.get(v.season) ?? { exp: 0, at: v.at };
    perSeason.set(v.season, { exp: s.exp + v.exp, at: v.at > s.at ? v.at : s.at });
  }
  for (const [gk, rows] of Array.from(byGuildSeason)) {
    const season = Number(gk.split('|')[0]);
    if (season >= maxSeason) continue; // current season still running
    rows.sort((a, b) => b.exp - a.exp);
    rows.forEach((r, i) => {
      if (!hashes.has(r.hash) || r.exp <= 0) return;
      if (i < 10 && (!top10 || r.at < top10)) top10 = r.at;
      if (i === 0 && (!top1 || r.at < top1)) top1 = r.at;
    });
  }
  const seasons = Array.from(perSeason.entries()).sort((a, b) => a[0] - b[0]);
  const bestSeason: MetricValue = {
    value: Math.max(0, ...seasons.map(([, s]) => s.exp)),
    at: (t) => seasons.find(([, s]) => s.exp >= t)?.[1].at ?? null,
  };
  return {
    bestSeason,
    seasons: series(seasons.map(([, s]) => ({ date: s.at, inc: 1 }))),
    top10: flag(top10),
    top1: flag(top1),
  };
}

export function computeMetrics(ctx: Context, acc: Account): Map<Metric, MetricValue> {
  const m = new Map<Metric, MetricValue>();
  const logs = acc.memberIds.flatMap((id) => ctx.logs.get(id) ?? []);
  const events = acc.memberIds.flatMap((id) => ctx.events.get(id) ?? []);
  const idSet = new Set(acc.memberIds);

  m.set('gold', series(logs.map((l) => ({ date: l.log_date, inc: (l.gold_donated ?? 0) + (l.deposits_gold ?? 0) }))));
  m.set('raids', series(logs.map((l) => ({ date: l.log_date, inc: l.raids ?? 0 }))));

  // Pooled account day: any character met = day met.
  const metDays = Array.from(new Set(logs.filter((l) => l.met_requirement).map((l) => l.log_date))).sort();
  m.set('met_days', series(metDays.map((d) => ({ date: d, inc: 1 }))));

  // Holidays: away days neither count nor break a streak.
  const awayDays = new Set<string>();
  const finishedAways: string[] = [];
  for (const a of ctx.away) {
    if (!a.member_ids?.some((id) => idSet.has(id))) continue;
    const end = a.ended_at && dateOf(a.ended_at) < a.ends_on ? dateOf(a.ended_at) : a.ends_on;
    for (let d = a.starts_on; d <= end; d = addDays(d, 1)) awayDays.add(d);
    if (end < ctx.today) finishedAways.push(end);
  }
  const metSet = new Set(metDays);
  const streakReach: string[] = []; // index n-1 → date the streak first reached n
  let best = 0;
  if (metDays.length) {
    let cur = 0;
    const last = logs.reduce((mx, l) => (l.log_date > mx ? l.log_date : mx), metDays[0]!);
    for (let d = metDays[0]!; d <= last; d = addDays(d, 1)) {
      if (metSet.has(d)) {
        cur++;
        if (cur > best) {
          best = cur;
          streakReach[cur - 1] = d;
        }
      } else if (!awayDays.has(d)) cur = 0;
    }
  }
  m.set('best_streak', { value: best, at: (t) => streakReach[t - 1] ?? null });

  // Challenges / stockpile: each item counts once per guild + game day, however many donations.
  const itemSeries = (type: string) => {
    const seen = new Map<string, string>();
    for (const e of events) {
      if (e.type !== type) continue;
      const day = gameDay(e.created_at);
      const k = `${e.guild_id}|${day}|${e.item_hashed_id ?? ''}`;
      if (!seen.has(k)) seen.set(k, day);
    }
    return series(Array.from(seen.values()).map((d) => ({ date: d, inc: 1 })));
  };
  m.set('challenge_items', itemSeries('CHALLENGE_CONTRIBUTION'));
  m.set('stockpile_items', itemSeries('DEPOSITED_STOCKPILE'));
  m.set('pool_activations', series(events.filter((e) => e.type === 'ACTIVATED_ENERGIZING_POOL').map((e) => ({ date: gameDay(e.created_at), inc: 1 }))));

  const hashes = new Set(acc.members.map((x) => x.hashed_id).filter(Boolean) as string[]);
  const asl = assaultFor(ctx, hashes);
  m.set('assault_best_season', asl.bestSeason);
  m.set('assault_seasons', asl.seasons);
  m.set('assault_top10', asl.top10);
  m.set('assault_top1', asl.top1);

  // Loyalty: from the first time any character shows up in a Dream guild.
  const starts = [
    ...logs.map((l) => l.log_date),
    ...acc.members.map((x) => (x.first_seen ? dateOf(x.first_seen) : null)).filter(Boolean) as string[],
  ].sort();
  const start = starts[0] ?? null;
  m.set('loyalty_days', start
    ? { value: Math.max(0, Math.round((Date.parse(ctx.today) - Date.parse(start)) / DAY)), at: (t) => addDays(start, t) }
    : plain(0));

  m.set('combat_level', plain(Math.max(0, ...acc.members.map((x) => x.combat_level ?? 0))));
  m.set('total_level', plain(Math.max(0, ...acc.members.map((x) => x.total_level ?? 0))));

  const discord = new Set(acc.discordIds);
  m.set('bumps', series(ctx.bumps
    .filter((b) => (b.member_id && idSet.has(b.member_id)) || (b.discord_id && discord.has(b.discord_id)))
    .map((b) => ({ date: dateOf(b.bumped_at), inc: 1 }))));

  const claim = ctx.claims.filter((c) => idSet.has(c.member_id)).map((c) => c.reviewed_at ?? c.requested_at).sort()[0];
  m.set('claimed', flag(claim ? dateOf(claim) : null, acc.userIds.length > 0));
  const link = acc.userIds.map((u) => ctx.links.get(u)?.linked_at).filter(Boolean).sort()[0] as string | undefined;
  m.set('discord_linked', flag(link ? dateOf(link) : null, !!link));

  // Journey from the guild each character was logged in.
  const firstIn = (pred: (g: GuildRow, gid: string) => boolean) =>
    logs.filter((l) => l.guild_id && ctx.guilds.has(l.guild_id) && pred(ctx.guilds.get(l.guild_id)!, l.guild_id)).map((l) => l.log_date).sort()[0] ?? null;
  const assaultGuild = (gid: string) => gid === ASSAULT_ENTRY_GUILD_ID || gid === ASSAULT_TOP_GUILD_ID;
  const currentIn = (gids: string[]) => acc.members.some((x) => x.is_active !== false && x.current_guild_id && gids.includes(x.current_guild_id));
  const aslDate = firstIn((_, gid) => assaultGuild(gid));
  m.set('assaulter', flag(aslDate, !!aslDate || currentIn([ASSAULT_ENTRY_GUILD_ID, ASSAULT_TOP_GUILD_ID])));
  const diDate = firstIn((_, gid) => gid === ASSAULT_TOP_GUILD_ID);
  m.set('invader', flag(diDate, !!diDate || currentIn([ASSAULT_TOP_GUILD_ID])));
  m.set('top_tier', flag(firstIn((g) => !g.is_assault && (g.min_level ?? 0) >= TOP_RAID_CL)));

  let movedUp: string | null = null;
  for (const id of acc.memberIds) {
    const own = (ctx.logs.get(id) ?? []).filter((l) => l.guild_id).sort((a, b) => (a.log_date < b.log_date ? -1 : 1));
    let prevTier: number | null = null;
    for (const l of own) {
      const g = ctx.guilds.get(l.guild_id!);
      if (!g || g.is_assault) continue;
      const tier = g.min_level ?? 0;
      if (prevTier !== null && tier > prevTier && (!movedUp || l.log_date < movedUp)) movedUp = l.log_date;
      prevTier = tier;
    }
  }
  m.set('moved_up', flag(movedUp));

  const firstPerGuild = new Map<string, string>();
  for (const l of logs) {
    if (!l.guild_id) continue;
    const p = firstPerGuild.get(l.guild_id);
    if (!p || l.log_date < p) firstPerGuild.set(l.guild_id, l.log_date);
  }
  m.set('guilds_visited', series(Array.from(firstPerGuild.values()).map((d) => ({ date: d, inc: 1 }))));

  const firstLog = logs.map((l) => l.log_date).sort()[0] ?? null;
  m.set('founder', flag(firstLog && firstLog < FOUNDER_BEFORE ? firstLog : null));

  m.set('top_donor_week', flag(ctx.topDonorWeek?.get(acc.key) ?? null));
  m.set('network_week_1', flag(ctx.networkWeek1?.get(acc.key) ?? null));

  let comeback: string | null = null;
  for (const end of finishedAways) {
    const after = metDays.find((d) => d > end);
    if (after && (!comeback || after < comeback)) comeback = after;
  }
  m.set('comeback', flag(comeback));

  return m;
}

// ─── Accounts ────────────────────────────────────────────────────────────────

async function buildAccounts(supabase: SupabaseClient, members: MemberRow[], ctx: Pick<Context, 'claims' | 'links'>): Promise<Account[]> {
  const keys = await getAccountKeys(supabase, members.map((m) => m.id));
  const groups = new Map<string, MemberRow[]>();
  for (const m of members) {
    const k = keys.get(m.id) ?? m.id;
    const a = groups.get(k) ?? [];
    a.push(m);
    groups.set(k, a);
  }
  return Array.from(groups.entries()).map(([key, ms]) => {
    const ids = new Set(ms.map((m) => m.id));
    const userIds = Array.from(new Set(ctx.claims.filter((c) => ids.has(c.member_id)).map((c) => c.user_id)));
    const discordIds = Array.from(new Set([
      ...ms.map((m) => m.discord_id).filter(Boolean) as string[],
      ...userIds.map((u) => ctx.links.get(u)?.discord_id).filter(Boolean) as string[],
    ]));
    return { key, memberIds: ms.map((m) => m.id), members: ms, main: pickMain(ms), discordIds, userIds };
  });
}

// ─── Daily run ───────────────────────────────────────────────────────────────

export const BACKFILL_SETTING = 'achievements_backfilled_at';
export const LAUNCH_POST_SETTING = 'achievements_launch_posted_at';

interface UnlockRow { member_id: string; achievement_key: string; unlocked_at: string; backfilled: boolean; announced_at: string | null }

export interface RunResult {
  accounts: number;
  new_unlocks: number; // per account
  backfill: boolean;
  by_tier: Record<string, number>;
  /** Account-level unlocks recorded this run (for the digest). */
  fresh: Array<{ account: Account; achievement: Achievement }>;
}

async function getSetting(supabase: SupabaseClient, key: string): Promise<string | null> {
  const { data } = await supabase.from('app_settings').select('value').eq('key', key).maybeSingle();
  return (data?.value as string | undefined) ?? null;
}
export const setSetting = (supabase: SupabaseClient, key: string, value: string) =>
  supabase.from('app_settings').upsert({ key, value }, { onConflict: 'key' });

export async function loadAllMembers(supabase: SupabaseClient): Promise<MemberRow[]> {
  return fetchAll<MemberRow>((f, t) => supabase.from('members').select(MEMBER_COLS).order('id').range(f, t));
}

/**
 * Evaluate every account and record new unlocks. The first run ever (no BACKFILL_SETTING) is the
 * silent launch backfill: unlocks get their historical date and are marked announced.
 */
export async function runAchievements(supabase: SupabaseClient, opts: { dryRun?: boolean } = {}): Promise<RunResult> {
  const members = await loadAllMembers(supabase);
  const ctx = await loadContext(supabase, members, true);
  const accounts = await buildAccounts(supabase, members, ctx);
  const accountOf = new Map<string, string>();
  for (const a of accounts) for (const id of a.memberIds) accountOf.set(id, a.key);
  weeklyWinners(ctx, accountOf);

  const backfill = !(await getSetting(supabase, BACKFILL_SETTING));
  const existing = await fetchAll<UnlockRow>((f, t) =>
    supabase.from('achievement_unlocks').select('member_id, achievement_key, unlocked_at, backfilled, announced_at').range(f, t)
  ).catch((e) => {
    if (opts.dryRun) return [] as UnlockRow[]; // migration not run yet: preview everything
    throw e;
  });
  const byMember = new Map<string, Map<string, UnlockRow>>();
  for (const r of existing) {
    const m = byMember.get(r.member_id) ?? new Map<string, UnlockRow>();
    m.set(r.achievement_key, r);
    byMember.set(r.member_id, m);
  }

  const now = new Date().toISOString();
  const inserts: UnlockRow[] = [];
  const fresh: RunResult['fresh'] = [];
  const byTier: Record<string, number> = {};

  for (const acc of accounts) {
    // Union of what any character of the account already has (alts regrouped since → copy over).
    const had = new Map<string, UnlockRow>();
    for (const id of acc.memberIds) for (const [k, r] of Array.from(byMember.get(id) ?? [])) {
      const prev = had.get(k);
      if (!prev || r.unlocked_at < prev.unlocked_at) had.set(k, r);
    }
    const metrics = computeMetrics(ctx, acc);
    const earned = new Map<string, UnlockRow>();
    for (const a of ACHIEVEMENTS) {
      if (had.has(a.key)) { earned.set(a.key, had.get(a.key)!); continue; }
      const mv = metrics.get(a.metric);
      if (!mv || mv.value < a.threshold) continue;
      const at = mv.at(a.threshold);
      const row: UnlockRow = {
        member_id: '',
        achievement_key: a.key,
        // Backfill keeps the historical date; later unlocks are dated when recorded.
        unlocked_at: backfill && at ? `${at}T12:00:00Z` : now,
        backfilled: backfill,
        announced_at: backfill ? now : null,
      };
      earned.set(a.key, row);
      fresh.push({ account: acc, achievement: a });
      byTier[a.tier] = (byTier[a.tier] ?? 0) + 1;
    }
    for (const id of acc.memberIds) {
      const mine = byMember.get(id);
      for (const [k, r] of Array.from(earned)) {
        if (mine?.has(k)) continue;
        // Copies for regrouped alts keep the original date and never re-announce.
        const isCopy = had.has(k);
        inserts.push({ ...r, member_id: id, announced_at: isCopy ? (r.announced_at ?? now) : r.announced_at });
      }
    }
  }

  if (!opts.dryRun) {
    for (const part of chunks(inserts, 500)) {
      const { error } = await supabase.from('achievement_unlocks').upsert(part, { onConflict: 'member_id,achievement_key', ignoreDuplicates: true });
      if (error) throw new Error(error.message);
    }
    if (backfill) await setSetting(supabase, BACKFILL_SETTING, now);
  }

  return { accounts: accounts.length, new_unlocks: fresh.length, backfill, by_tier: byTier, fresh };
}

// ─── One account (for /me and Discord /me) ───────────────────────────────────

export interface AchievementView {
  key: string;
  name: string;
  description: string;
  category: Achievement['category'];
  tier: Achievement['tier'];
  hidden: boolean;
  threshold: number;
  value: number;
  unlocked_at: string | null;
  title: boolean;
}

export interface AccountAchievements {
  unlocked: number;
  total: number;
  xp: number;
  title: { key: string; name: string } | null;
  achievements: AchievementView[];
}

/** Progress + unlocks for the account containing `memberIds`. Hidden locked ones come back masked. */
export async function accountProgress(supabase: SupabaseClient, memberIds: string[], userId?: string | null): Promise<AccountAchievements> {
  const { data: rows } = await supabase.from('members').select(MEMBER_COLS).in('id', memberIds);
  const members = (rows ?? []) as MemberRow[];
  const [ctx, { data: unlockRows }, titleRow] = await Promise.all([
    loadContext(supabase, members, false),
    supabase.from('achievement_unlocks').select('achievement_key, unlocked_at').in('member_id', memberIds),
    userId ? supabase.from('user_titles').select('achievement_key').eq('user_id', userId).maybeSingle().then((r) => r.data) : Promise.resolve(null),
  ]);
  const ids = new Set(memberIds);
  const userIds = Array.from(new Set(ctx.claims.filter((c) => ids.has(c.member_id)).map((c) => c.user_id)));
  const acc: Account = {
    key: memberIds.slice().sort()[0] ?? '',
    memberIds,
    members,
    main: pickMain(members),
    userIds,
    discordIds: Array.from(new Set([
      ...members.map((m) => m.discord_id).filter(Boolean) as string[],
      ...userIds.map((u) => ctx.links.get(u)?.discord_id).filter(Boolean) as string[],
    ])),
  };
  const metrics = members.length ? computeMetrics(ctx, acc) : new Map<Metric, MetricValue>();
  const unlocked = new Map<string, string>();
  for (const r of unlockRows ?? []) {
    const prev = unlocked.get(r.achievement_key);
    if (!prev || r.unlocked_at < prev) unlocked.set(r.achievement_key, r.unlocked_at);
  }

  const achievements = ACHIEVEMENTS.map((a): AchievementView => {
    const at = unlocked.get(a.key) ?? null;
    const masked = a.hidden && !at;
    return {
      key: a.key,
      name: masked ? '???' : a.name,
      description: masked ? 'Hidden achievement' : a.description,
      category: a.category,
      tier: a.tier,
      hidden: !!a.hidden,
      threshold: a.threshold,
      value: masked ? 0 : Math.min(metrics.get(a.metric)?.value ?? 0, a.threshold),
      unlocked_at: at,
      title: grantsTitle(a),
    };
  });
  const got = achievements.filter((a) => a.unlocked_at);
  const titleKey = titleRow?.achievement_key as string | undefined;
  const titleDef = titleKey && unlocked.has(titleKey) ? ACHIEVEMENT_BY_KEY.get(titleKey) : undefined;
  return {
    unlocked: got.length,
    total: ACHIEVEMENTS.length,
    xp: got.reduce((s, a) => s + TIERS[a.tier].xp, 0),
    title: titleDef ? { key: titleDef.key, name: titleDef.name } : null,
    achievements,
  };
}
