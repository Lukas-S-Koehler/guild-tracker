import type { SupabaseClient } from '@supabase/supabase-js';

export const COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2h

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

export async function getLastBumpMs(
  supabase: SupabaseClient,
  discordId: string
): Promise<number | null> {
  const { data } = await supabase
    .from('bumps')
    .select('bumped_at')
    .eq('discord_id', discordId)
    .order('bumped_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return new Date(data.bumped_at).getTime();
}

export async function insertBump(
  supabase: SupabaseClient,
  row: { discord_id: string; discord_username: string | null; member_id: string | null }
): Promise<void> {
  await supabase.from('bumps').insert(row);
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

export function medal(rank: number): string {
  if (rank === 0) return '🥇';
  if (rank === 1) return '🥈';
  if (rank === 2) return '🥉';
  return `${rank + 1}.`;
}
