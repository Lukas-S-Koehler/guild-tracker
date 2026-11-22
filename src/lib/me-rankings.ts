/**
 * Leaderboard ranks for /me, account-wide: all of the user's characters count as one entry,
 * ranked against everyone else's merged (main + alts) entry. Same data as /leaderboard
 * (activity score from the weekly/monthly/global views) and /assault/leaderboard (assault XP).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchLeaderboard, type LeaderboardPeriod } from '@/lib/leaderboard';
import { getAssaultLeaderboard, getCurrentSeason } from '@/lib/assault-standings-service';
import { getAccountCharacters } from '@/lib/account-service';

export interface Rank {
  rank: number;
  of: number;
  /** Ranked value: activity score, or assault XP. */
  value: number;
}

export interface ActivityRank extends Rank {
  raids: number;
  gold: number;
}

export interface AssaultRank extends Rank {
  kills: number;
}

export interface MeRankings {
  claimed: boolean;
  activity: { week: ActivityRank | null; month: ActivityRank | null; all: ActivityRank | null };
  /** This week inside the main character's guild. */
  guild_week: (ActivityRank & { guild_name: string }) | null;
  assault: { season: number; season_rank: AssaultRank | null; all_time: AssaultRank | null };
}

/** Rank `mine` among `others` (higher is better). Ties share a rank. */
function rankOf(mine: number, others: number[]): { rank: number; of: number } {
  return { rank: 1 + others.filter((v) => v > mine).length, of: others.length + 1 };
}

async function activityRank(supabase: SupabaseClient, ids: Set<string>, period: LeaderboardPeriod, guildFilter?: string): Promise<ActivityRank | null> {
  const entries = await fetchLeaderboard({ supabase, period, guildFilter, merged: true, filter: 'all' });
  const mine = entries.filter((e) => ids.has(e.id));
  if (mine.length === 0) return null;
  const value = mine.reduce((s, e) => s + (e.activity_score ?? 0), 0);
  if (value <= 0) return null;
  const others = entries.filter((e) => !ids.has(e.id)).map((e) => e.activity_score ?? 0);
  return {
    ...rankOf(value, others),
    value,
    raids: mine.reduce((s, e) => s + (e.total_raids ?? 0), 0),
    gold: mine.reduce((s, e) => s + (e.total_gold ?? 0), 0),
  };
}

async function assaultRank(ids: Set<string>, season?: number): Promise<AssaultRank | null> {
  // Merged rows are keyed by the main's member id (or the member id); untracked chars by `c<id>`.
  const { rows } = await getAssaultLeaderboard({ season, merged: true, limit: 100000 });
  const mine = rows.filter((r) => ids.has(r.key));
  if (mine.length === 0) return null;
  const value = mine.reduce((s, r) => s + r.experience, 0);
  if (value <= 0) return null;
  const others = rows.filter((r) => !ids.has(r.key)).map((r) => r.experience);
  return { ...rankOf(value, others), value, kills: mine.reduce((s, r) => s + r.kills, 0) };
}

export async function buildMeRankings(userId: string, supabase: SupabaseClient): Promise<MeRankings> {
  const characters = await getAccountCharacters(userId, supabase);
  const season = await getCurrentSeason();
  if (characters.length === 0) {
    return { claimed: false, activity: { week: null, month: null, all: null }, guild_week: null, assault: { season, season_rank: null, all_time: null } };
  }
  const ids = new Set(characters.map((c) => c.member_id));
  const main =
    characters.find((c) => c.claimed && c.in_dream_guild) ?? characters.find((c) => c.in_dream_guild) ?? null;

  const [week, month, all, guildWeek, seasonRank, allTime] = await Promise.all([
    activityRank(supabase, ids, 'week'),
    activityRank(supabase, ids, 'month'),
    activityRank(supabase, ids, 'all'),
    main?.guild_id ? activityRank(supabase, ids, 'week', main.guild_id) : Promise.resolve(null),
    assaultRank(ids, season),
    assaultRank(ids),
  ]);

  return {
    claimed: true,
    activity: { week, month, all },
    guild_week: guildWeek && main ? { ...guildWeek, guild_name: main.guild_nickname ?? main.guild_name ?? 'your guild' } : null,
    assault: { season, season_rank: seasonRank, all_time: allTime },
  };
}
