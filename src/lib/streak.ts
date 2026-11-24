/**
 * Account streak, the one official rule (leaderboard, achievements, profile, /me, Discord /me):
 *  - an account is the main + all alts (member_alts closure), across every guild
 *  - a day counts when any character of the account has a met log for it
 *  - /away holiday days and gap days (game days no activity fetch has read yet, see
 *    src/lib/fetch-runs.ts) neither count nor break the run
 * A character view uses the same rule on one character's own logs (Account | Character toggles).
 * A day without a met log is a real miss: the IdleMMO activity feed is timestamped and a
 * missed cron run is caught up by the next one (daily-activity re-reads from last_fetched_at).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadGapDays } from '@/lib/fetch-runs';

const DAY = 86_400_000;
const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
const dateOf = (iso: string) => iso.slice(0, 10);

export interface AwayRow {
  member_ids: string[] | null;
  starts_on: string;
  ends_on: string;
  ended_at: string | null;
}

/** Last checked game day = yesterday (UTC calendar), like the activity check. */
export const lastCheckedDay = (now = new Date()) => addDays(now.toISOString().slice(0, 10), -1);

/** Holiday days (up to `day`) of any away period covering one of the account's characters. */
export function awayDaysFor(away: AwayRow[], ids: Set<string>, day: string): Set<string> {
  const out = new Set<string>();
  for (const a of away) {
    if (!a.member_ids?.some((id) => ids.has(id))) continue;
    const end = a.ended_at && dateOf(a.ended_at) < a.ends_on ? dateOf(a.ended_at) : a.ends_on;
    for (let d = a.starts_on; d <= end && d <= day; d = addDays(d, 1)) out.add(d);
  }
  return out;
}

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

/**
 * Days that pause a streak for these characters: their /away holidays plus the gap days of
 * their current guilds.
 */
export function pauseDaysFor(
  away: AwayRow[],
  gaps: Map<string, Set<string>>,
  chars: { member_id: string; guild_id: string | null }[],
  day: string
): Set<string> {
  const out = awayDaysFor(away, new Set(chars.map((c) => c.member_id)), day);
  for (const c of chars) gaps.get(c.guild_id ?? '')?.forEach((d) => out.add(d));
  return out;
}

export interface StreakResult {
  current: number;
  best: number;
}

/** Account streak plus one streak per character, from the account's logs (all guilds). */
export async function loadStreaks(
  supabase: SupabaseClient,
  chars: { member_id: string; guild_id: string | null }[],
  logs: { member_id: string; log_date: string; met_requirement: boolean | null }[]
): Promise<{ account: StreakResult; characters: ({ member_id: string } & StreakResult)[] }> {
  const day = lastCheckedDay();
  if (!chars.length) return { account: { current: 0, best: 0 }, characters: [] };
  const [{ data }, gaps] = await Promise.all([
    supabase
      .from('away_periods')
      .select('member_ids, starts_on, ends_on, ended_at')
      .overlaps('member_ids', chars.map((c) => c.member_id)),
    loadGapDays(supabase, day),
  ]);
  const away = (data ?? []) as AwayRow[];
  const metOf = (ls: typeof logs) => new Set(ls.filter((l) => l.met_requirement).map((l) => l.log_date));
  return {
    account: accountStreak(metOf(logs), pauseDaysFor(away, gaps, chars, day), day),
    characters: chars.map((c) => ({
      member_id: c.member_id,
      ...accountStreak(metOf(logs.filter((l) => l.member_id === c.member_id)), pauseDaysFor(away, gaps, [c], day), day),
    })),
  };
}
