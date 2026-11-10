import type { SupabaseClient } from '@supabase/supabase-js';

export const COOLDOWN_MS = 60 * 60 * 1000; // 1h — rule is per-guild, not per-user

export const MILESTONES = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
export const STREAK_MILESTONES = [3, 7, 14, 30, 60, 100];

export type BumpConfig = {
  bump_server_id: string;
  bump_channel_id: string;
  bump_king_role_id: string;
  bump_button_message_id: string;
  current_bump_king_discord_id: string;
  bump_source_url: string;
};

export type BumpEntry = {
  discord_id: string;
  discord_username: string | null;
  member_ign: string | null;
  count: number;
  streak?: number;
};

export type StreakEntry = {
  discord_id: string;
  discord_username: string | null;
  member_ign: string | null;
  streak: number;
};

const CONFIG_KEYS: (keyof BumpConfig)[] = [
  'bump_server_id',
  'bump_channel_id',
  'bump_king_role_id',
  'bump_button_message_id',
  'current_bump_king_discord_id',
  'bump_source_url',
];

export async function readBumpConfig(supabase: SupabaseClient): Promise<BumpConfig> {
  const { data } = await supabase
    .from('app_settings')
    .select('key, value')
    .in('key', CONFIG_KEYS as string[]);
  const out: BumpConfig = {
    bump_server_id: '',
    bump_channel_id: '',
    bump_king_role_id: '',
    bump_button_message_id: '',
    current_bump_king_discord_id: '',
    bump_source_url: '',
  };
  for (const row of (data ?? []) as Array<{ key: string; value: string }>) {
    if ((CONFIG_KEYS as string[]).includes(row.key)) {
      (out as unknown as Record<string, string>)[row.key] = row.value ?? '';
    }
  }
  return out;
}

export async function writeBumpConfig(
  supabase: SupabaseClient,
  patch: Partial<BumpConfig>
): Promise<void> {
  const rows = Object.entries(patch).map(([key, value]) => ({ key, value: value ?? '' }));
  if (rows.length === 0) return;
  await supabase.from('app_settings').upsert(rows);
}

/** Most recent bump by ANY user (cooldown is per-guild/global, not per-user). */
export async function getLastBumpMs(supabase: SupabaseClient): Promise<{
  ms: number;
  discord_id: string;
} | null> {
  const { data } = await supabase
    .from('bumps')
    .select('bumped_at, discord_id')
    .order('bumped_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return { ms: new Date(data.bumped_at).getTime(), discord_id: data.discord_id };
}

export async function insertBump(
  supabase: SupabaseClient,
  row: { discord_id: string; discord_username: string | null; member_id: string | null }
): Promise<void> {
  await supabase.from('bumps').insert(row);
}

export type RecentBump = {
  discord_id: string;
  discord_username: string | null;
  member_ign: string | null;
  bumped_at: string;
  total_for_user: number;
  streak_for_user: number;
};

export async function getRecentBumps(
  supabase: SupabaseClient,
  limit: number
): Promise<RecentBump[]> {
  const { data } = await supabase
    .from('bumps')
    .select('discord_id, discord_username, bumped_at, members:member_id(ign)')
    .order('bumped_at', { ascending: false })
    .limit(limit);

  const rows = (data ?? []) as unknown as BumpRowWithMember[];
  const result: RecentBump[] = [];
  for (const r of rows) {
    const ign = Array.isArray(r.members) ? r.members[0]?.ign ?? null : r.members?.ign ?? null;
    const [total, streak] = await Promise.all([
      countBumpsForUser(supabase, r.discord_id),
      getUserStreak(supabase, r.discord_id),
    ]);
    result.push({
      discord_id: r.discord_id,
      discord_username: r.discord_username,
      member_ign: ign,
      bumped_at: r.bumped_at ?? '',
      total_for_user: total,
      streak_for_user: streak,
    });
  }
  return result;
}

export async function countBumpsForUser(
  supabase: SupabaseClient,
  discordId: string
): Promise<number> {
  const { count } = await supabase
    .from('bumps')
    .select('*', { count: 'exact', head: true })
    .eq('discord_id', discordId);
  return count ?? 0;
}

type BumpRowWithMember = {
  discord_id: string;
  discord_username: string | null;
  bumped_at?: string;
  members: { ign: string } | { ign: string }[] | null;
};

function aggregate(rows: BumpRowWithMember[] | null, limit: number): BumpEntry[] {
  const map = new Map<string, BumpEntry>();
  for (const r of rows ?? []) {
    const ign = Array.isArray(r.members) ? r.members[0]?.ign ?? null : r.members?.ign ?? null;
    const existing = map.get(r.discord_id);
    if (existing) {
      existing.count++;
      if (!existing.member_ign && ign) existing.member_ign = ign;
      if (!existing.discord_username && r.discord_username) existing.discord_username = r.discord_username;
    } else {
      map.set(r.discord_id, {
        discord_id: r.discord_id,
        discord_username: r.discord_username,
        member_ign: ign,
        count: 1,
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count).slice(0, limit);
}

export async function getAllTimeLeaderboard(
  supabase: SupabaseClient,
  limit: number
): Promise<BumpEntry[]> {
  const { data } = await supabase
    .from('bumps')
    .select('discord_id, discord_username, members:member_id(ign)');
  return aggregate(data as unknown as BumpRowWithMember[] | null, limit);
}

export async function getMonthlyLeaderboard(
  supabase: SupabaseClient,
  limit: number
): Promise<BumpEntry[]> {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const { data } = await supabase
    .from('bumps')
    .select('discord_id, discord_username, members:member_id(ign)')
    .gte('bumped_at', start.toISOString());
  return aggregate(data as unknown as BumpRowWithMember[] | null, limit);
}

/** Monthly top-N with streak field populated for each entry. */
export async function getMonthlyLeaderboardWithStreaks(
  supabase: SupabaseClient,
  limit: number
): Promise<BumpEntry[]> {
  const entries = await getMonthlyLeaderboard(supabase, limit);
  const streaks = await Promise.all(entries.map((e) => getUserStreak(supabase, e.discord_id)));
  return entries.map((e, i) => ({ ...e, streak: streaks[i] }));
}

export async function getPrevMonthTop(supabase: SupabaseClient): Promise<BumpEntry | null> {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const { data } = await supabase
    .from('bumps')
    .select('discord_id, discord_username, members:member_id(ign)')
    .gte('bumped_at', start.toISOString())
    .lt('bumped_at', end.toISOString());
  const agg = aggregate(data as unknown as BumpRowWithMember[] | null, 1);
  return agg[0] ?? null;
}

export function computeStreak(bumpTimes: Date[], now = new Date()): number {
  if (bumpTimes.length === 0) return 0;
  const days = new Set<string>(bumpTimes.map(utcDayKey));
  const todayKey = utcDayKey(now);
  const yesterdayKey = utcDayKey(new Date(now.getTime() - 86400000));

  let cursor: Date;
  if (days.has(todayKey)) cursor = new Date(now);
  else if (days.has(yesterdayKey)) cursor = new Date(now.getTime() - 86400000);
  else return 0;

  let streak = 0;
  while (days.has(utcDayKey(cursor))) {
    streak++;
    cursor = new Date(cursor.getTime() - 86400000);
  }
  return streak;
}

function utcDayKey(d: Date): string {
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}

export async function getUserStreak(
  supabase: SupabaseClient,
  discordId: string
): Promise<number> {
  const lookback = new Date(Date.now() - 65 * 86400000);
  const { data } = await supabase
    .from('bumps')
    .select('bumped_at')
    .eq('discord_id', discordId)
    .gte('bumped_at', lookback.toISOString());
  const times = (data ?? []).map((r) => new Date(r.bumped_at));
  return computeStreak(times);
}

export async function getStreakLeaderboard(
  supabase: SupabaseClient,
  limit: number
): Promise<StreakEntry[]> {
  const lookback = new Date(Date.now() - 65 * 86400000);
  const { data } = await supabase
    .from('bumps')
    .select('discord_id, discord_username, bumped_at, members:member_id(ign)')
    .gte('bumped_at', lookback.toISOString());

  const byUser = new Map<string, { times: Date[]; username: string | null; ign: string | null }>();
  for (const r of (data ?? []) as unknown as BumpRowWithMember[]) {
    const ign = Array.isArray(r.members) ? r.members[0]?.ign ?? null : r.members?.ign ?? null;
    const existing = byUser.get(r.discord_id);
    if (existing) {
      if (r.bumped_at) existing.times.push(new Date(r.bumped_at));
      if (!existing.ign && ign) existing.ign = ign;
      if (!existing.username && r.discord_username) existing.username = r.discord_username;
    } else {
      byUser.set(r.discord_id, {
        times: r.bumped_at ? [new Date(r.bumped_at)] : [],
        username: r.discord_username,
        ign,
      });
    }
  }

  const entries: StreakEntry[] = [];
  for (const [discord_id, v] of Array.from(byUser.entries())) {
    const streak = computeStreak(v.times);
    if (streak > 0) {
      entries.push({ discord_id, discord_username: v.username, member_ign: v.ign, streak });
    }
  }
  return entries.sort((a, b) => b.streak - a.streak).slice(0, limit);
}

export function formatCooldown(msRemaining: number): string {
  const totalMin = Math.ceil(msRemaining / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

export function displayName(e: {
  discord_id: string;
  discord_username: string | null;
  member_ign: string | null;
}): string {
  if (e.member_ign) return e.member_ign;
  if (e.discord_username) return e.discord_username;
  return `<@${e.discord_id}>`;
}

export function buildBumpMessage(opts: {
  sourceUrl?: string;
  recent: RecentBump[];
  monthly: BumpEntry[];
  lastBumpMs: number | null;
  cooldownMs: number;
}): { content: string; components: unknown[] } {
  const { sourceUrl, recent, monthly, lastBumpMs, cooldownMs } = opts;

  const buttons: Array<Record<string, unknown>> = [];
  if (sourceUrl) {
    buttons.push({ type: 2, style: 5, label: '🔗 Go Bump!', url: sourceUrl });
  }
  buttons.push({ type: 2, style: 1, label: '🚀 I Bumped!', custom_id: 'bump_click' });

  const now = Date.now();
  const nextMs = lastBumpMs !== null ? lastBumpMs + cooldownMs : 0;
  const nextLine =
    nextMs > now
      ? `⏰ **Next bump:** <t:${Math.floor(nextMs / 1000)}:R> (<t:${Math.floor(nextMs / 1000)}:t>)`
      : '✅ **Ready to bump!**';

  const steps = sourceUrl
    ? [
        '**How it works:**',
        '1. Click 🔗 **Go Bump!** → opens main IdleMMO bump channel',
        '2. Post "bump" there, delete your message',
        '3. Come back and click 🚀 **I Bumped!** to log it',
      ].join('\n')
    : 'Bumped our guild ad in the main IdleMMO Discord? Click 🚀 **I Bumped!** below to log it.';

  // Oldest first, newest at bottom.
  const recentOrdered = [...recent].reverse();
  const activityLines =
    recentOrdered.length === 0
      ? ['_No bumps yet — be the first!_']
      : recentOrdered.map((r) => {
          const name = r.discord_username || r.member_ign || `<@${r.discord_id}>`;
          const ts = Math.floor(new Date(r.bumped_at).getTime() / 1000);
          const streak = r.streak_for_user > 1 ? ` 🔥${r.streak_for_user}d` : '';
          return `• **${name}**${streak} — <t:${ts}:R>`;
        });

  const monthName = new Date().toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const monthlyLines =
    monthly.length === 0
      ? ['_No bumps this month yet._']
      : monthly.map((m, i) => {
          const rank = i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉';
          const name = m.discord_username || m.member_ign || `<@${m.discord_id}>`;
          const streak = m.streak && m.streak > 1 ? ` 🔥${m.streak}d` : '';
          return `${rank} **${name}**${streak} — ${m.count}`;
        });

  const content = [
    `## 🏆 ${monthName} Leaderboard`,
    ...monthlyLines,
    '',
    '━━━━━━━━━━━━━━━━━━━━',
    '',
    '# 🚀 Guild Bumping',
    '',
    steps,
    '',
    '**Rules (read carefully!):**',
    '⚠️ **1 bump per guild per hour** — NOT per person. If someone else just bumped, wait the hour. Bumping early = breaking main server rules.',
    '• Top bumper each month earns 👑 **Bump King** role',
    '• Streaks, milestones, bragging rights 🔥',
    '',
    nextLine,
    '',
    '**🔄 Recent bumps**',
    ...activityLines,
    '',
    '_Run `/bumps` for full leaderboard._',
  ].join('\n');

  return { content, components: [{ type: 1, components: buttons }] };
}

export function medal(rank: number): string {
  if (rank === 0) return '🥇';
  if (rank === 1) return '🥈';
  if (rank === 2) return '🥉';
  return `${rank + 1}.`;
}
