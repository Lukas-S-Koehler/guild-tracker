/**
 * Network leaderboards (Dream Hub step 13, F2). Every board ranks ACCOUNTS (main + alts, full
 * member_alts closure), like /me and achievements, across all Dream guilds:
 *
 *  - streak:      current run of met days (any character met = day met; holidays neither count
 *                 nor break it), same rule as the Streak achievements
 *  - best_streak: longest run ever, same rule
 *  - improved:    activity score of the last 7 checked game days vs the 7 before
 *                 (score = raids × 1,000 + gold, same as /leaderboard); only accounts active in both
 *  - dream_xp:    achievement Dream XP + rank (src/lib/achievement-ranks.ts)
 *
 * Per class lives on the activity board (/leaderboard class filter), since class is per character.
 * Data only changes once a day (11:48 UTC check), so the result is cached for 30 minutes.
 */
import { unstable_cache } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase-server';
import { getAccountKeys, getDesignatedMainWeights } from '@/lib/alt-graph';
import { rankFor, unlockKeysByMember, xpOf } from '@/lib/achievement-ranks';

export type NetworkBoardKey = 'streak' | 'best_streak' | 'improved' | 'dream_xp';

export const NETWORK_BOARDS: Record<NetworkBoardKey, { label: string; emoji: string; description: string }> = {
  streak: {
    label: 'Current streak',
    emoji: '🔥',
    description: 'Days in a row the requirement was met (any character counts, holidays pause it)',
  },
  best_streak: {
    label: 'Longest streak',
    emoji: '🏔️',
    description: 'Longest run of met days ever (any character counts, holidays pause it)',
  },
  improved: {
    label: 'Most improved',
    emoji: '📈',
    description: 'Activity score of the last 7 days vs the 7 days before (active in both)',
  },
  dream_xp: {
    label: 'Dream XP',
    emoji: '🌌',
    description: 'Achievement XP: Bronze 10 · Silver 25 · Gold 50 · Crystal 100 · Dream 200',
  },
};

export interface NetworkRow {
  /** Account key (stable). */
  key: string;
  ign: string;
  class: string | null;
  guild_nickname: string | null;
  alt_igns: string[];
  value: number;
  /** improved: score before / after. */
  before?: number;
  after?: number;
  /** dream_xp: unlocked count + rank. */
  unlocked?: number;
  rank_name?: string | null;
  rank_emoji?: string | null;
}

export interface NetworkBoards {
  generated_at: string;
  /** Last checked game day the boards cover. */
  day: string;
  /** improved windows (inclusive). */
  windows: { before: [string, string]; after: [string, string] };
  boards: Record<NetworkBoardKey, NetworkRow[]>;
  classes: string[];
}

const DAY = 86_400_000;
const PAGE = 1000;
const LIMIT = 100;

const dateOf = (iso: string) => iso.slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);

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

interface MemberRow {
  id: string;
  ign: string;
  class: string | null;
  character_id: number | null;
  current_guild_id: string | null;
  is_active: boolean | null;
}
interface LogRow { member_id: string; log_date: string; raids: number | null; gold_donated: number | null; deposits_gold: number | null; met_requirement: boolean | null }
interface AwayRow { member_ids: string[] | null; starts_on: string; ends_on: string; ended_at: string | null }

/**
 * Current + best run of met days. A day with no met log breaks the run unless it is a holiday day.
 * The current run may end on `day` or the day before (today's check may not be in yet).
 */
export function accountStreak(metDays: Set<string>, awayDays: Set<string>, day: string): { current: number; best: number } {
  const sorted = Array.from(metDays).sort();
  if (!sorted.length) return { current: 0, best: 0 };
  let best = 0;
  let cur = 0;
  for (let d = sorted[0]!; d <= sorted[sorted.length - 1]!; d = addDays(d, 1)) {
    if (metDays.has(d)) best = Math.max(best, ++cur);
    else if (!awayDays.has(d)) cur = 0;
  }
  let current = 0;
  let d = metDays.has(day) || awayDays.has(day) ? day : addDays(day, -1);
  for (;;) {
    if (metDays.has(d)) current++;
    else if (!awayDays.has(d)) break;
    d = addDays(d, -1);
    if (d < sorted[0]!) break;
  }
  return { current, best };
}

const score = (l: LogRow) => (l.raids ?? 0) * 1000 + (l.gold_donated ?? 0) + (l.deposits_gold ?? 0);

export async function buildNetworkBoards(supabase: SupabaseClient): Promise<NetworkBoards> {
  // Last checked game day = yesterday (UTC calendar), like the activity check.
  const day = addDays(new Date().toISOString().slice(0, 10), -1);
  const after: [string, string] = [addDays(day, -6), day];
  const before: [string, string] = [addDays(day, -13), addDays(day, -7)];

  const [members, logs, away, guilds] = await Promise.all([
    fetchAll<MemberRow>((f, t) => supabase.from('members').select('id, ign, class, character_id, current_guild_id, is_active').order('id').range(f, t)),
    fetchAll<LogRow>((f, t) => supabase.from('daily_logs').select('member_id, log_date, raids, gold_donated, deposits_gold, met_requirement').order('id').range(f, t)),
    fetchAll<AwayRow>((f, t) => supabase.from('away_periods').select('member_ids, starts_on, ends_on, ended_at').range(f, t)),
    supabase.from('guilds').select('id, nickname').then((r) => (r.data ?? []) as Array<{ id: string; nickname: string | null }>),
  ]);
  const tag = new Map(guilds.map((g) => [g.id, g.nickname]));
  const inDream = (m: MemberRow) => m.is_active !== false && !!m.current_guild_id && tag.has(m.current_guild_id);

  // Accounts: only those with a character in a Dream guild right now.
  const [keys, mainWeight] = await Promise.all([
    getAccountKeys(supabase, members.map((m) => m.id)),
    getDesignatedMainWeights(supabase),
  ]);
  const accounts = new Map<string, MemberRow[]>();
  for (const m of members) {
    const k = keys.get(m.id) ?? m.id;
    const a = accounts.get(k) ?? [];
    a.push(m);
    accounts.set(k, a);
  }
  const logsBy = new Map<string, LogRow[]>();
  for (const l of logs) {
    const a = logsBy.get(l.member_id) ?? [];
    a.push(l);
    logsBy.set(l.member_id, a);
  }

  const unlocks = await unlockKeysByMember(supabase);

  const boards: Record<NetworkBoardKey, NetworkRow[]> = { streak: [], best_streak: [], improved: [], dream_xp: [] };
  for (const [key, ms] of Array.from(accounts)) {
    const dream = ms.filter(inDream);
    if (!dream.length) continue;
    // Display character: the account's set main when it is in a Dream guild, else the oldest
    // Dream character. Class always comes from the set main.
    const designated = ms
      .filter((m) => mainWeight.has(m.id))
      .sort((a, b) => mainWeight.get(b.id)! - mainWeight.get(a.id)!)[0];
    const main =
      (designated && inDream(designated) ? designated : undefined) ??
      dream.slice().sort((a, b) => (a.character_id ?? Infinity) - (b.character_id ?? Infinity))[0]!;
    const base = {
      key,
      ign: main.ign,
      class: (designated ?? main).class,
      guild_nickname: tag.get(main.current_guild_id!) ?? null,
      alt_igns: ms.filter((m) => m.id !== main.id && m.is_active !== false).map((m) => m.ign),
    };
    const ids = new Set(ms.map((m) => m.id));
    const accLogs = ms.flatMap((m) => logsBy.get(m.id) ?? []);

    // Streaks
    const met = new Set(accLogs.filter((l) => l.met_requirement).map((l) => l.log_date));
    const awayDays = new Set<string>();
    for (const a of away) {
      if (!a.member_ids?.some((id) => ids.has(id))) continue;
      const end = a.ended_at && dateOf(a.ended_at) < a.ends_on ? dateOf(a.ended_at) : a.ends_on;
      for (let d = a.starts_on; d <= end && d <= day; d = addDays(d, 1)) awayDays.add(d);
    }
    const s = accountStreak(met, awayDays, day);
    if (s.current > 0) boards.streak.push({ ...base, value: s.current });
    if (s.best > 0) boards.best_streak.push({ ...base, value: s.best });

    // Most improved
    let b = 0;
    let a = 0;
    let bLogged = false;
    let aLogged = false;
    for (const l of accLogs) {
      if (l.log_date >= before[0] && l.log_date <= before[1]) { b += score(l); bLogged = true; }
      else if (l.log_date >= after[0] && l.log_date <= after[1]) { a += score(l); aLogged = true; }
    }
    if (bLogged && aLogged && b > 0 && a > b) boards.improved.push({ ...base, value: a - b, before: b, after: a });

    // Dream XP (every unlock is written to every character, union = account total)
    const keysUnlocked = new Set<string>();
    for (const m of ms) unlocks.get(m.id)?.forEach((k) => keysUnlocked.add(k));
    const xp = xpOf(keysUnlocked);
    if (xp > 0) {
      const r = rankFor(xp);
      boards.dream_xp.push({ ...base, value: xp, unlocked: keysUnlocked.size, rank_name: r?.name ?? null, rank_emoji: r?.emoji ?? null });
    }
  }

  for (const k of Object.keys(boards) as NetworkBoardKey[]) {
    boards[k].sort((x, y) => y.value - x.value || x.ign.localeCompare(y.ign));
    boards[k] = boards[k].slice(0, LIMIT);
  }

  const classes = Array.from(new Set(members.filter(inDream).map((m) => m.class).filter(Boolean) as string[])).sort();
  return { generated_at: new Date().toISOString(), day, windows: { before, after }, boards, classes };
}

/** Cached for 30 minutes (boards only move once a day). */
export const getNetworkBoards = unstable_cache(
  async () => buildNetworkBoards(createAdminClient()),
  ['network-boards-v1'],
  { revalidate: 1800 }
);

/** Competition rank: ties share a place. */
export function placeOf(rows: NetworkRow[], i: number): number {
  let p = i;
  while (p > 0 && rows[p - 1]!.value === rows[i]!.value) p--;
  return p + 1;
}
