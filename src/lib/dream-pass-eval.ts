/**
 * Dream Pass evaluator (step 15). Recomputes every account's XP per season from source data and stores
 * it in `dream_pass_scores` (one row per character of the account, `is_main` marks the one to list).
 * Recomputing (instead of appending events) keeps the numbers right when logs arrive late, alts are
 * regrouped or a source is fixed. Finished seasons are frozen in `dream_pass_seasons` and never rewritten.
 *
 * Sources and values: src/lib/dream-pass.ts (PASS_XP). Spec: docs/dream-pass.md.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildAccounts, loadAllMembers, type Account } from '@/lib/achievement-eval';
import { ACHIEVEMENT_BY_KEY, TIERS } from '@/lib/achievements';
import { chatDays, chatStats, type ChatStats } from '@/lib/discord-chat';
import {
  FINALIZE_GRACE_DAYS,
  LIFETIME,
  MILESTONE_LEVELS,
  PASS_XP,
  contributionXp,
  currentSeason,
  passLevel,
  FIRST_SEASON,
  seasonEnd,
  seasonOf,
  type Breakdown,
  type PassSource,
} from '@/lib/dream-pass';
import type { Standing } from '@/lib/dream-pass-read';

const DAY = 86_400_000;
/**
 * Pseudo-season for assault seasons from before per-wave tracking: their real dates are unknown (all were
 * imported on 2026-11-21), so their XP counts for lifetime Dream XP only, never for a monthly season.
 */
export const HISTORY = 'history';
const PAGE = 1000;
const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
const dateOf = (iso: string) => iso.slice(0, 10);

async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>, optional = false): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) {
      if (optional) return out; // table from a migration not run yet
      throw new Error(error.message);
    }
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

// ─── Data ────────────────────────────────────────────────────────────────────

interface LogRow { member_id: string; log_date: string; raids: number | null; gold_donated: number | null; deposits_gold: number | null; met_requirement: boolean | null }
interface RunRow { id: string; external_guild_id: number; zone_id: number; season_number: number | null; starts_at: string; status: string }
interface ContribRow { run_id: string; character_id: number; character_hashed_id: string | null; experience: number | null }
interface SeasonRow { season_number: number; zone_id: number; external_guild_id: number; character_id: number; character_hashed_id: string | null; experience: number | null; snapshot_at: string }
interface StandingRow { season_number: number; zone_id: number; external_guild_id: number; position: number }
interface AwayRow { member_ids: string[]; starts_on: string; ends_on: string; ended_at: string | null }

interface PassData {
  logs: LogRow[];
  runs: RunRow[];
  contribs: ContribRow[];
  seasonContribs: SeasonRow[];
  standings: StandingRow[];
  away: AwayRow[];
  bumps: Array<{ discord_id: string | null; member_id: string | null; bumped_at: string }>;
  kudos: Array<{ giver_member_id: string | null; recipient_member_id: string; created_at: string }>;
  unlocks: Array<{ member_id: string; achievement_key: string; unlocked_at: string; backfilled: boolean | null }>;
  chat: Map<string, ChatStats>;
}

async function loadData(supabase: SupabaseClient): Promise<PassData> {
  const runs = await fetchAll<RunRow>((f, t) => supabase.from('assault_runs').select('id, external_guild_id, zone_id, season_number, starts_at, status').eq('status', 'finalized').range(f, t), true);
  const [logs, contribs, seasonContribs, standings, away, bumps, kudos, unlocks, chat] = await Promise.all([
    fetchAll<LogRow>((f, t) => supabase.from('daily_logs').select('member_id, log_date, raids, gold_donated, deposits_gold, met_requirement').order('id').range(f, t)),
    Promise.all(chunks(runs.map((r) => r.id), 100).map((ids) => fetchAll<ContribRow>((f, t) => supabase.from('assault_contributions').select('run_id, character_id, character_hashed_id, experience').in('run_id', ids).range(f, t), true))).then((r) => r.flat()),
    fetchAll<SeasonRow>((f, t) => supabase.from('assault_season_contributions').select('season_number, zone_id, external_guild_id, character_id, character_hashed_id, experience, snapshot_at').range(f, t), true),
    fetchAll<StandingRow>((f, t) => supabase.from('assault_zone_standings').select('season_number, zone_id, external_guild_id, position').range(f, t), true),
    fetchAll<AwayRow>((f, t) => supabase.from('away_periods').select('member_ids, starts_on, ends_on, ended_at').range(f, t), true),
    fetchAll<PassData['bumps'][number]>((f, t) => supabase.from('bumps').select('discord_id, member_id, bumped_at').range(f, t), true),
    fetchAll<PassData['kudos'][number]>((f, t) => supabase.from('kudos').select('giver_member_id, recipient_member_id, created_at').order('id').range(f, t), true),
    fetchAll<PassData['unlocks'][number]>((f, t) => supabase.from('achievement_unlocks').select('member_id, achievement_key, unlocked_at, backfilled').order('member_id').order('achievement_key').range(f, t), true),
    chatStats(supabase),
  ]);
  return { logs, runs, contribs, seasonContribs, standings, away, bumps, kudos, unlocks, chat };
}

// ─── Computation ─────────────────────────────────────────────────────────────

/** season → source → xp, for one account. */
export type AccountXp = Map<string, Breakdown>;

function addXp(out: AccountXp, date: string, source: PassSource, xp: number) {
  if (!xp) return;
  const s = date === HISTORY || seasonOf(date) < FIRST_SEASON ? HISTORY : seasonOf(date);
  const b = out.get(s) ?? {};
  b[source] = (b[source] ?? 0) + xp;
  out.set(s, b);
}

/** Index source rows by account once, then compute each account. */
export function computeAll(accounts: Account[], data: PassData, members: Array<{ id: string; hashed_id: string | null; character_id: number | null }>): Map<string, AccountXp> {
  const accountOf = new Map<string, string>(); // member id → account key
  for (const a of accounts) for (const id of a.memberIds) accountOf.set(id, a.key);
  const byCharId = new Map<number, string>();
  const byHash = new Map<string, string>();
  for (const m of members) {
    if (m.character_id != null) byCharId.set(m.character_id, m.id);
    if (m.hashed_id) byHash.set(m.hashed_id, m.id);
  }
  const memberOfChar = (cid: number, hash: string | null) => byCharId.get(cid) ?? (hash ? byHash.get(hash) : undefined);
  const discordAccount = new Map<string, string>();
  for (const a of accounts) for (const d of a.discordIds) if (!discordAccount.has(d)) discordAccount.set(d, a.key);

  const result = new Map<string, AccountXp>();
  const xpOf = (key: string) => {
    let x = result.get(key);
    if (!x) { x = new Map(); result.set(key, x); }
    return x;
  };

  // ── Daily logs: met days + streaks, raids, contribution value.
  const metDays = new Map<string, Set<string>>();
  const valueDays = new Map<string, Map<string, number>>();
  for (const l of data.logs) {
    const acc = accountOf.get(l.member_id);
    if (!acc) continue;
    addXp(xpOf(acc), l.log_date, 'raids', (l.raids ?? 0) * PASS_XP.raid);
    if (l.met_requirement) {
      const s = metDays.get(acc) ?? new Set<string>();
      s.add(l.log_date);
      metDays.set(acc, s);
    }
    const v = (l.gold_donated ?? 0) + (l.deposits_gold ?? 0);
    if (v > 0) {
      const m = valueDays.get(acc) ?? new Map<string, number>();
      m.set(l.log_date, (m.get(l.log_date) ?? 0) + v);
      valueDays.set(acc, m);
    }
  }
  for (const [acc, days] of Array.from(valueDays)) for (const [d, v] of Array.from(days)) addXp(xpOf(acc), d, 'contribution', contributionXp(v));

  const awayByAccount = new Map<string, Set<string>>();
  for (const a of data.away) {
    const end = a.ended_at && dateOf(a.ended_at) < a.ends_on ? dateOf(a.ended_at) : a.ends_on;
    for (const id of a.member_ids ?? []) {
      const acc = accountOf.get(id);
      if (!acc) continue;
      const s = awayByAccount.get(acc) ?? new Set<string>();
      for (let d = a.starts_on; d <= end; d = addDays(d, 1)) s.add(d);
      awayByAccount.set(acc, s);
    }
  }
  for (const [acc, set] of Array.from(metDays)) {
    const days = Array.from(set).sort();
    const x = xpOf(acc);
    for (const d of days) addXp(x, d, 'daily', PASS_XP.met);
    // Streak: consecutive met days; holidays pause, anything else breaks.
    const away = awayByAccount.get(acc) ?? new Set<string>();
    let run = 0;
    for (let d = days[0]!, last = days[days.length - 1]!; d <= last; d = addDays(d, 1)) {
      if (set.has(d)) {
        run++;
        if (run % 7 === 0) addXp(x, d, 'streak', PASS_XP.streak7);
      } else if (!away.has(d)) run = 0;
    }
  }

  // ── Assault waves (finalized runs): account counts once per wave.
  const runById = new Map(data.runs.map((r) => [r.id, r]));
  const waveExp = new Map<string, Map<string, number>>(); // run → account → exp
  for (const c of data.contribs) {
    const mid = memberOfChar(c.character_id, c.character_hashed_id);
    const acc = mid ? accountOf.get(mid) : undefined;
    if (!acc) continue;
    const m = waveExp.get(c.run_id) ?? new Map<string, number>();
    m.set(acc, (m.get(acc) ?? 0) + Number(c.experience ?? 0));
    waveExp.set(c.run_id, m);
  }
  const zoneKey = (season: number | null, guild: number, zone: number) => `${season}|${guild}|${zone}`;
  const guildWaves = new Map<string, number>(); // season|guild|zone → finalized waves
  const attended = new Map<string, Map<string, number>>(); // season|guild|zone → account → waves
  const seasonsWithRuns = new Set<string>(); // season|guild
  for (const r of data.runs) {
    const zk = zoneKey(r.season_number, r.external_guild_id, r.zone_id);
    guildWaves.set(zk, (guildWaves.get(zk) ?? 0) + 1);
    seasonsWithRuns.add(`${r.season_number}|${r.external_guild_id}`);
  }
  for (const [runId, accs] of Array.from(waveExp)) {
    const run = runById.get(runId);
    if (!run) continue;
    const zk = zoneKey(run.season_number, run.external_guild_id, run.zone_id);
    for (const [acc, exp] of Array.from(accs)) {
      if (exp < PASS_XP.waveMinExp) continue;
      addXp(xpOf(acc), dateOf(run.starts_at), 'assault', PASS_XP.wave + Math.min(PASS_XP.waveExpCap, Math.floor(exp / PASS_XP.waveExpPer)));
      const m = attended.get(zk) ?? new Map<string, number>();
      m.set(acc, (m.get(acc) ?? 0) + 1);
      attended.set(zk, m);
    }
  }

  // ── Assault season finish (finished seasons only: below the newest season number).
  const maxSeason = Math.max(0, ...data.seasonContribs.map((r) => r.season_number));
  const groups = new Map<string, { exp: Map<string, number>; at: string; season: number; guild: number; zone: number }>();
  for (const r of data.seasonContribs) {
    if (r.season_number >= maxSeason) continue;
    const mid = memberOfChar(r.character_id, r.character_hashed_id);
    const acc = mid ? accountOf.get(mid) : undefined;
    const zk = zoneKey(r.season_number, r.external_guild_id, r.zone_id);
    const g = groups.get(zk) ?? { exp: new Map<string, number>(), at: dateOf(r.snapshot_at), season: r.season_number, guild: r.external_guild_id, zone: r.zone_id };
    if (dateOf(r.snapshot_at) > g.at) g.at = dateOf(r.snapshot_at);
    if (acc) g.exp.set(acc, (g.exp.get(acc) ?? 0) + Number(r.experience ?? 0));
    groups.set(zk, g);
  }
  const standing = new Map(data.standings.map((s) => [zoneKey(s.season_number, s.external_guild_id, s.zone_id), s.position]));
  // A season with wave data in any guild has trustworthy dates; older ones go to HISTORY.
  const trackedSeasons = new Set(data.runs.map((r) => r.season_number));
  for (const [zk, g] of Array.from(groups)) {
    const ranked = Array.from(g.exp.entries()).filter(([, e]) => e > 0).sort((a, b) => b[1] - a[1]);
    const when = trackedSeasons.has(g.season) ? g.at : HISTORY;
    const hasRuns = seasonsWithRuns.has(`${g.season}|${g.guild}`);
    const pos = standing.get(zk);
    const waves = guildWaves.get(zk) ?? 0;
    ranked.forEach(([acc, exp], i) => {
      const x = xpOf(acc);
      if (i === 0) addXp(x, when, 'assault_finish', PASS_XP.top1);
      else if (i < 10) addXp(x, when, 'assault_finish', PASS_XP.top10);
      // Territory: guild top 10 in the zone; with wave data you need half the waves, before it any EXP.
      if (pos != null && pos <= 10) {
        const ok = hasRuns ? (attended.get(zk)?.get(acc) ?? 0) * 2 >= waves && waves > 0 : exp >= PASS_XP.waveMinExp;
        if (ok) addXp(x, when, 'assault_finish', PASS_XP.territory);
      }
      // Seasons before per-wave tracking: estimate waves from season EXP (~20k per wave, max 9).
      if (!hasRuns && exp >= PASS_XP.waveMinExp) {
        const est = Math.min(9, Math.ceil(exp / 20_000));
        addXp(x, when, 'assault', est * PASS_XP.wave + Math.min(Math.floor(exp / PASS_XP.waveExpPer), est * PASS_XP.waveExpCap));
      }
    });
  }

  // ── Kudos.
  for (const k of data.kudos) {
    const to = accountOf.get(k.recipient_member_id);
    if (to) addXp(xpOf(to), dateOf(k.created_at), 'kudos', PASS_XP.kudosReceived);
    const from = k.giver_member_id ? accountOf.get(k.giver_member_id) : undefined;
    if (from) addXp(xpOf(from), dateOf(k.created_at), 'kudos', PASS_XP.kudosGiven);
  }

  // ── Bumps (by Discord id, else the stored member).
  for (const b of data.bumps) {
    const acc = (b.discord_id ? discordAccount.get(b.discord_id) : undefined) ?? (b.member_id ? accountOf.get(b.member_id) : undefined);
    if (acc) addXp(xpOf(acc), dateOf(b.bumped_at), 'bumps', PASS_XP.bump);
  }

  // ── Discord chat days (an account with two Discord ids counts a day once).
  for (const a of accounts) {
    const days = new Set<string>();
    for (const d of a.discordIds) chatDays(data.chat.get(d)).forEach((x) => days.add(x));
    for (const d of Array.from(days)) addXp(xpOf(a.key), d, 'chat', PASS_XP.chatDay);
  }

  // ── Achievements: tier XP of each unlock (account union, earliest date). Unlocks from a silent launch
  // backfill have unreliable dates (many were stamped "now"), so they count for lifetime only.
  const firstUnlock = new Map<string, Map<string, { at: string; backfilled: boolean }>>();
  for (const u of data.unlocks) {
    const acc = accountOf.get(u.member_id);
    if (!acc) continue;
    const m = firstUnlock.get(acc) ?? new Map<string, { at: string; backfilled: boolean }>();
    const prev = m.get(u.achievement_key);
    if (!prev || u.unlocked_at < prev.at) m.set(u.achievement_key, { at: u.unlocked_at, backfilled: !!u.backfilled });
    firstUnlock.set(acc, m);
  }
  for (const [acc, m] of Array.from(firstUnlock)) {
    for (const [key, u] of Array.from(m)) {
      const a = ACHIEVEMENT_BY_KEY.get(key);
      if (a) addXp(xpOf(acc), u.backfilled ? HISTORY : dateOf(u.at), 'achievements', TIERS[a.tier].xp);
    }
  }

  return result;
}

export const totalOf = (b: Breakdown) => Object.values(b).reduce((s, v) => s + (v ?? 0), 0);

// ─── Daily run ───────────────────────────────────────────────────────────────

export const PASS_LAUNCH_SETTING = 'dream_pass_launched_at';

export interface PassRunResult {
  accounts: number;
  seasons: string[];
  rows: number;
  finalized: string[];
  milestones: number;
  launch: boolean;
}

interface ScoreRow { member_id: string; season: string; account_key: string; is_main: boolean; xp: number; level: number; breakdown: Breakdown; computed_at: string }

export async function runDreamPass(supabase: SupabaseClient, opts: { dryRun?: boolean } = {}): Promise<PassRunResult & { preview?: Array<{ ign: string; season: number; lifetime: number }> }> {
  const members = await loadAllMembers(supabase);
  const [claims, links] = await Promise.all([
    fetchAll<{ user_id: string; member_id: string; reviewed_at: string | null; requested_at: string | null }>((f, t) =>
      supabase.from('user_characters').select('user_id, member_id, reviewed_at, requested_at').eq('status', 'approved').range(f, t)),
    fetchAll<{ user_id: string; discord_id: string; linked_at: string }>((f, t) => supabase.from('user_discord_links').select('user_id, discord_id, linked_at').range(f, t), true),
  ]);
  const accounts = await buildAccounts(supabase, members, { claims, links: new Map(links.map((l) => [l.user_id, { discord_id: l.discord_id, linked_at: l.linked_at }])) });
  const data = await loadData(supabase);
  const xp = computeAll(accounts, data, members);

  const { data: frozenRows } = await supabase.from('dream_pass_seasons').select('season');
  const frozen = new Set((frozenRows ?? []).map((r) => r.season as string));
  const launch = !(await getSetting(supabase, PASS_LAUNCH_SETTING));
  const now = new Date().toISOString();
  const cur = currentSeason();

  const rows: ScoreRow[] = [];
  const seasons = new Set<string>();
  const preview: Array<{ ign: string; season: number; lifetime: number }> = [];
  for (const acc of accounts) {
    const perSeason = xp.get(acc.key);
    if (!perSeason?.size) continue;
    const lifetime: Breakdown = {};
    for (const [season, b] of Array.from(perSeason)) {
      for (const [k, v] of Object.entries(b)) lifetime[k as PassSource] = (lifetime[k as PassSource] ?? 0) + (v ?? 0);
      if (frozen.has(season) || season === HISTORY) continue;
      seasons.add(season);
      const total = totalOf(b);
      for (const id of acc.memberIds) rows.push({ member_id: id, season, account_key: acc.key, is_main: id === acc.main.id, xp: total, level: passLevel(total).level, breakdown: b, computed_at: now });
    }
    const life = totalOf(lifetime);
    for (const id of acc.memberIds) rows.push({ member_id: id, season: LIFETIME, account_key: acc.key, is_main: id === acc.main.id, xp: life, level: 0, breakdown: lifetime, computed_at: now });
    preview.push({ ign: acc.main.ign, season: totalOf(perSeason.get(cur) ?? {}), lifetime: life });
  }

  const result: PassRunResult = { accounts: accounts.length, seasons: Array.from(seasons).sort(), rows: rows.length, finalized: [], milestones: 0, launch };
  if (opts.dryRun) {
    const pct = (v: number[]) => {
      const a = v.filter((x) => x > 0).sort((x, y) => x - y);
      const q = (f: number) => a[Math.floor(f * (a.length - 1))] ?? 0;
      return { n: a.length, p50: q(0.5), p75: q(0.75), p90: q(0.9), max: a[a.length - 1] ?? 0 };
    };
    const mains = rows.filter((r) => r.is_main);
    const stats: Record<string, ReturnType<typeof pct>> = {};
    for (const se of [...Array.from(seasons).sort(), LIFETIME]) stats[se] = pct(mains.filter((r) => r.season === se).map((r) => r.xp));
    const life = mains.filter((r) => r.season === LIFETIME).map((r) => r.xp);
    const ladder = [250, 300, 500, 1000, 1250, 1500, 2500, 3000, 4000, 5000, 6000, 7500, 10000, 12500, 15000];
    const atLeast = Object.fromEntries(ladder.map((t) => [t, life.filter((x) => x >= t).length]));
    return { ...result, stats, at_least: atLeast, preview: preview.sort((a, b) => b.lifetime - a.lifetime).slice(0, 15) } as PassRunResult & { preview: typeof preview };
  }

  for (const part of chunks(rows, 500)) {
    const { error } = await supabase.from('dream_pass_scores').upsert(part, { onConflict: 'member_id,season' });
    if (error) throw new Error(error.message);
  }
  // Rows not rewritten this run (account regrouped, character gone) are stale — except frozen seasons.
  const { error: delErr } = await supabase.from('dream_pass_scores').delete().lt('computed_at', now).not('season', 'in', `(${Array.from(frozen).map((s) => `"${s}"`).join(',') || '"-"'})`);
  if (delErr) throw new Error(delErr.message);

  result.milestones = await recordMilestones(supabase, rows.filter((r) => r.is_main && r.season === cur), launch);
  result.finalized = await finalizeSeasons(supabase, rows, frozen, accounts, launch);
  if (launch) await setSetting(supabase, PASS_LAUNCH_SETTING, now);
  return result;
}

async function getSetting(supabase: SupabaseClient, key: string): Promise<string | null> {
  const { data } = await supabase.from('app_settings').select('value').eq('key', key).maybeSingle();
  return (data?.value as string | undefined) ?? null;
}
const setSetting = (supabase: SupabaseClient, key: string, value: string) => supabase.from('app_settings').upsert({ key, value }, { onConflict: 'key' });

/** New level milestones of the open season. At launch they are recorded silently. */
async function recordMilestones(supabase: SupabaseClient, mains: ScoreRow[], silent: boolean): Promise<number> {
  const want = mains.flatMap((r) => MILESTONE_LEVELS.filter((l) => r.level >= l).map((level) => ({ season: r.season, account_key: r.account_key, level, member_id: r.member_id })));
  if (!want.length) return 0;
  const season = mains[0]!.season;
  const { data: have } = await supabase.from('dream_pass_milestones').select('account_key, level').eq('season', season);
  const seen = new Set((have ?? []).map((h) => `${h.account_key}|${h.level}`));
  const fresh = want.filter((w) => !seen.has(`${w.account_key}|${w.level}`));
  const now = new Date().toISOString();
  for (const part of chunks(fresh, 500)) {
    const { error } = await supabase.from('dream_pass_milestones').upsert(part.map((p) => ({ ...p, reached_at: now, announced_at: silent ? now : null })), { onConflict: 'season,account_key,level', ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  }
  return fresh.length;
}


/** Freeze seasons that ended FINALIZE_GRACE_DAYS ago. At launch, old seasons are frozen already announced. */
async function finalizeSeasons(supabase: SupabaseClient, rows: ScoreRow[], frozen: Set<string>, accounts: Account[], launch: boolean): Promise<string[]> {
  const today = new Date().toISOString().slice(0, 10);
  const accByKey = new Map(accounts.map((a) => [a.key, a]));
  const done: string[] = [];
  const due = Array.from(new Set(rows.map((r) => r.season))).filter((s) => s !== LIFETIME && !frozen.has(s) && addDays(seasonEnd(s), FINALIZE_GRACE_DAYS) <= today).sort();
  for (const season of due) {
    const mains = rows.filter((r) => r.season === season && r.is_main && r.xp > 0).sort((a, b) => b.xp - a.xp);
    const standings: Standing[] = [];
    mains.slice(0, 10).forEach((r, i) => {
      const acc = accByKey.get(r.account_key);
      const place = i > 0 && r.xp === mains[i - 1]!.xp ? standings[i - 1]!.place : i + 1;
      standings.push({ place, member_id: r.member_id, member_ids: acc?.memberIds ?? [r.member_id], ign: acc?.main.ign ?? '?', xp: r.xp, level: r.level, discord_id: acc?.discordIds[0] ?? null });
    });
    // Ties at place 10 are champions too.
    for (const r of mains.slice(10)) {
      if (r.xp !== mains[9]!.xp) break;
      const acc = accByKey.get(r.account_key);
      standings.push({ place: standings[9]!.place, member_id: r.member_id, member_ids: acc?.memberIds ?? [r.member_id], ign: acc?.main.ign ?? '?', xp: r.xp, level: r.level, discord_id: acc?.discordIds[0] ?? null });
    }
    const { error } = await supabase.from('dream_pass_seasons').insert({ season, standings, announced_at: launch ? new Date().toISOString() : null });
    if (error && !/duplicate/.test(error.message)) throw new Error(error.message);
    done.push(season);
  }
  return done;
}

