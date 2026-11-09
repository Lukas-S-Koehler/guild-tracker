import type { SupabaseClient } from '@supabase/supabase-js';

export const COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2h

export const MILESTONES = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
export const STREAK_MILESTONES = [3, 7, 14, 30, 60, 100];

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

type BumpRow = {
  discord_id: string;
  discord_username: string | null;
  member_id: string | null;
  bumped_at: string;
};

/** Resolve game guild_id from Discord guild/server id via guild_config.settings. */
export async function resolveGameGuildId(
  supabase: SupabaseClient,
  discordGuildId: string
): Promise<string | null> {
  const { data } = await supabase
    .from('guild_config')
    .select('guild_id, settings')
    .limit(500);
  if (!data) return null;
  const match = data.find(
    (r: { settings: { discord_server_id?: string } | null }) =>
      r.settings?.discord_server_id === discordGuildId
  );
  return (match as { guild_id: string } | undefined)?.guild_id ?? null;
}

async function getBumpSettings(
  supabase: SupabaseClient,
  guildId: string
): Promise<Record<string, unknown>> {
  const { data } = await supabase
    .from('guild_config')
    .select('settings')
    .eq('guild_id', guildId)
    .maybeSingle();
  return (data?.settings as Record<string, unknown>) ?? {};
}

export async function readBumpConfig(
  supabase: SupabaseClient,
  guildId: string
): Promise<{
  bump_channel_id?: string;
  bump_button_message_id?: string;
  bump_king_role_id?: string;
  current_bump_king_discord_id?: string;
  discord_server_id?: string;
}> {
  const s = await getBumpSettings(supabase, guildId);
  return s as never;
}

export async function updateBumpConfig(
  supabase: SupabaseClient,
  guildId: string,
  patch: Record<string, unknown>
): Promise<void> {
  const current = await getBumpSettings(supabase, guildId);
  await supabase
    .from('guild_config')
    .update({ settings: { ...current, ...patch } })
    .eq('guild_id', guildId);
}

/** Most recent bump timestamp for a user in a guild (ms since epoch), or null. */
export async function getLastBumpMs(
  supabase: SupabaseClient,
  guildId: string,
  discordId: string
): Promise<number | null> {
  const { data } = await supabase
    .from('bumps')
    .select('bumped_at')
    .eq('guild_id', guildId)
    .eq('discord_id', discordId)
    .order('bumped_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return new Date(data.bumped_at).getTime();
}

export async function insertBump(
  supabase: SupabaseClient,
  row: {
    guild_id: string;
    discord_id: string;
    discord_username: string | null;
    member_id: string | null;
  }
): Promise<void> {
  await supabase.from('bumps').insert(row);
}

export async function countBumpsForUser(
  supabase: SupabaseClient,
  guildId: string,
  discordId: string
): Promise<number> {
  const { count } = await supabase
    .from('bumps')
    .select('*', { count: 'exact', head: true })
    .eq('guild_id', guildId)
    .eq('discord_id', discordId);
  return count ?? 0;
}

export async function getAllTimeLeaderboard(
  supabase: SupabaseClient,
  guildId: string,
  limit: number
): Promise<BumpEntry[]> {
  const { data } = await supabase
    .from('bumps')
    .select('discord_id, discord_username, members:member_id(ign)')
    .eq('guild_id', guildId);
  return aggregate(data as unknown as BumpRowWithMember[] | null, limit);
}

export async function getMonthlyLeaderboard(
  supabase: SupabaseClient,
  guildId: string,
  limit: number
): Promise<BumpEntry[]> {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const { data } = await supabase
    .from('bumps')
    .select('discord_id, discord_username, members:member_id(ign)')
    .eq('guild_id', guildId)
    .gte('bumped_at', start.toISOString());
  return aggregate(data as unknown as BumpRowWithMember[] | null, limit);
}

/** Previous calendar month's top bumper. */
export async function getPrevMonthTop(
  supabase: SupabaseClient,
  guildId: string
): Promise<BumpEntry | null> {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const { data } = await supabase
    .from('bumps')
    .select('discord_id, discord_username, members:member_id(ign)')
    .eq('guild_id', guildId)
    .gte('bumped_at', start.toISOString())
    .lt('bumped_at', end.toISOString());
  const agg = aggregate(data as unknown as BumpRowWithMember[] | null, 1);
  return agg[0] ?? null;
}

type BumpRowWithMember = {
  discord_id: string;
  discord_username: string | null;
  members: { ign: string } | { ign: string }[] | null;
};

function aggregate(rows: BumpRowWithMember[] | null, limit: number): BumpEntry[] {
  const map = new Map<string, BumpEntry>();
  for (const r of rows ?? []) {
    const existing = map.get(r.discord_id);
    const ign = Array.isArray(r.members) ? r.members[0]?.ign ?? null : r.members?.ign ?? null;
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

/** Streak of consecutive UTC days ending today (or yesterday if nothing today). */
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
  guildId: string,
  discordId: string
): Promise<number> {
  const lookback = new Date(Date.now() - 65 * 86400000);
  const { data } = await supabase
    .from('bumps')
    .select('bumped_at')
    .eq('guild_id', guildId)
    .eq('discord_id', discordId)
    .gte('bumped_at', lookback.toISOString());
  const times = (data ?? []).map((r) => new Date(r.bumped_at));
  return computeStreak(times);
}

export async function getStreakLeaderboard(
  supabase: SupabaseClient,
  guildId: string,
  limit: number
): Promise<StreakEntry[]> {
  const lookback = new Date(Date.now() - 65 * 86400000);
  const { data } = await supabase
    .from('bumps')
    .select('discord_id, discord_username, bumped_at, members:member_id(ign)')
    .eq('guild_id', guildId)
    .gte('bumped_at', lookback.toISOString());

  const byUser = new Map<string, { times: Date[]; username: string | null; ign: string | null }>();
  for (const r of (data ?? []) as unknown as (BumpRow & { members: { ign: string } | { ign: string }[] | null })[]) {
    const ign = Array.isArray(r.members) ? r.members[0]?.ign ?? null : r.members?.ign ?? null;
    const existing = byUser.get(r.discord_id);
    if (existing) {
      existing.times.push(new Date(r.bumped_at));
      if (!existing.ign && ign) existing.ign = ign;
      if (!existing.username && r.discord_username) existing.username = r.discord_username;
    } else {
      byUser.set(r.discord_id, {
        times: [new Date(r.bumped_at)],
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

export function displayName(e: { discord_id: string; discord_username: string | null; member_ign: string | null }): string {
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
