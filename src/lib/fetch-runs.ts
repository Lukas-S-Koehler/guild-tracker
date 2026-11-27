/**
 * Activity fetch hardening (database/activity-fetch-runs.sql).
 *
 * Every activity fetch records which window of the IdleMMO guild activity feed it fully read.
 * The feed is timestamped, so a late or missed run is caught up by the next one; until then the
 * game days nobody read are "gap days":
 *  - streaks pause on them (neither count nor break), like /away holidays
 *  - the watchdog (assault-scheduler tick, pg_cron every minute) alerts staff on Discord when a
 *    guild's fetch keeps failing (e.g. API key rejected)
 * Days before a guild's first recorded run count as covered (no history to judge them by).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { DAY_BOUNDARY_OFFSET_MINUTES } from '@/lib/activity-processor';
import { postToChannel } from '@/lib/discord-api';

/** leadership-chat (same channel as the unmapped-members report). */
const ALERT_CHANNEL_ID = '1444751853500760146';
const DAY = 86_400_000;
const BOUNDARY = DAY_BOUNDARY_OFFSET_MINUTES * 60_000;
/** The daily run lands 2 min before the boundary; the next run's overlap covers the rest. */
const SLACK = 15 * 60_000;

export type FetchSource = 'cron' | 'backfill' | 'manual';

export interface FetchRunInput {
  guild_id: string;
  source: FetchSource;
  ok: boolean;
  events?: number;
  covered_from?: Date | null;
  covered_to?: Date | null;
  error?: string | null;
}

/** Never throws: a missing table (migration not run yet) must not break the fetch. */
export async function recordFetchRun(supabase: SupabaseClient, r: FetchRunInput): Promise<void> {
  try {
    const { error } = await supabase.from('activity_fetch_runs').insert({
      guild_id: r.guild_id,
      source: r.source,
      ok: r.ok,
      events: r.events ?? 0,
      covered_from: r.covered_from?.toISOString() ?? null,
      covered_to: r.covered_to?.toISOString() ?? null,
      error: r.error?.slice(0, 500) ?? null,
    });
    if (error) console.warn('[fetch-runs] record failed:', error.message);
  } catch (e) {
    console.warn('[fetch-runs] record failed:', e);
  }
}

const gameDayOf = (t: number) => new Date(t - BOUNDARY).toISOString().slice(0, 10);
const dayStart = (d: string) => Date.parse(d + 'T00:00:00Z') + BOUNDARY;
const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);

interface RunRow { guild_id: string; run_at: string; ok: boolean; covered_from: string | null; covered_to: string | null }

/**
 * Game days (up to and including `day`) that no ok run of the guild fully read, per guild.
 * Guilds without any recorded run have no gap days.
 */
export async function loadGapDays(supabase: SupabaseClient, day: string): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  const rows: RunRow[] = [];
  try {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from('activity_fetch_runs')
        .select('guild_id, run_at, ok, covered_from, covered_to')
        .order('id')
        .range(from, from + 999);
      if (error || !data) break;
      rows.push(...(data as RunRow[]));
      if (data.length < 1000) break;
    }
  } catch {
    return out;
  }

  const byGuild = new Map<string, RunRow[]>();
  for (const r of rows) byGuild.set(r.guild_id, [...(byGuild.get(r.guild_id) ?? []), r]);

  byGuild.forEach((runs, guild) => {
    const first = runs.reduce((a, b) => (a.run_at < b.run_at ? a : b));
    // First full game day inside the first recorded window; earlier days were read before tracking.
    const t0 = Date.parse(first.covered_from ?? first.run_at);
    const d0 = gameDayOf(t0);
    const start = dayStart(d0) < t0 ? addDays(d0, 1) : d0;
    // Merge the ok windows.
    const iv = runs
      .filter((r) => r.ok)
      .map((r) => [r.covered_from ? Date.parse(r.covered_from) : -Infinity, Date.parse(r.covered_to ?? r.run_at)] as [number, number])
      .sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [];
    for (const [a, b] of iv) {
      const last = merged[merged.length - 1];
      if (last && a <= last[1]) last[1] = Math.max(last[1], b);
      else merged.push([a, b]);
    }
    const gaps = new Set<string>();
    for (let d = start; d <= day; d = addDays(d, 1)) {
      const s = dayStart(d);
      const e = s + DAY - SLACK;
      if (!merged.some(([a, b]) => a <= s && b >= e)) gaps.add(d);
    }
    if (gaps.size) out.set(guild, gaps);
  });
  return out;
}

/** Send once per (day, key); the insert is the lock. */
async function alertOnce(supabase: SupabaseClient, day: string, key: string, text: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('activity_fetch_alerts')
    .upsert({ day, key }, { onConflict: 'day,key', ignoreDuplicates: true })
    .select('key');
  if (error || !data?.length) return false;
  await postToChannel(ALERT_CHANNEL_ID, text);
  return true;
}

/**
 * Cheap check, safe to call every minute. After 12:30 UTC, once per day per guild: a guild whose
 * latest run failed, or whose last ok run is 50 h+ old. No alert for a merely late daily run: the
 * GitHub cron lands hours late every day and the next run catches up anyway.
 */
export async function runFetchWatchdog(supabase: SupabaseClient, now = new Date()): Promise<{ alerts: string[] }> {
  const alerts: string[] = [];
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  if (minutes < 12 * 60 + 30) return { alerts };
  const today = now.toISOString().slice(0, 10);

  const { data: recent, error } = await supabase
    .from('activity_fetch_runs')
    .select('guild_id, run_at, ok, source, error')
    .gte('run_at', new Date(now.getTime() - 4 * DAY).toISOString())
    .order('run_at', { ascending: false })
    .limit(2000);
  if (error) return { alerts }; // table not migrated yet
  const runs = recent ?? [];

  const { data: cfgs } = await supabase.from('guild_config').select('guild_id, guild_name, api_key').not('api_key', 'is', null).neq('api_key', 'placeholder');
  for (const c of cfgs ?? []) {
    const mine = runs.filter((r) => r.guild_id === c.guild_id);
    if (!mine.length) continue; // no recent history to judge by
    const latest = mine[0]!;
    const lastOk = mine.find((r) => r.ok);
    const stale = !lastOk || now.getTime() - Date.parse(lastOk.run_at) > 50 * 3600_000;
    if (latest.ok && !stale) continue;
    const err = String(latest.error ?? '');
    const authCode = err.match(/\b(401|403)\b/)?.[1] ?? (/unauthori/i.test(err) ? '401' : null);
    const why = authCode
      ? `the API key was rejected (${authCode}). A leader of the guild needs to set a new key in Admin → Guilds.`
      : err
        ? `the last fetch failed: \`${err.slice(0, 200)}\``
        : 'no successful fetch in over 2 days.';
    const sent = await alertOnce(
      supabase,
      today,
      `guild:${c.guild_id}`,
      `⚠️ **${c.guild_name ?? c.guild_id}**: activity is not being tracked, ${why}\nStreaks pause for its members until it is fixed; the next working run catches up on the missed days.`
    );
    if (sent) alerts.push(`guild:${c.guild_id}`);
  }
  return { alerts };
}
