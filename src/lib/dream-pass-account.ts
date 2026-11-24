/**
 * Dream Pass card data for one account (step 15): season pass + lifetime Dream XP + rank + Discord level.
 * Used by /api/me/pass, /api/profile/[ign]/pass and Discord /pass.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { nextRank, rankFor } from '@/lib/achievement-ranks';
import { chatStats } from '@/lib/discord-chat';
import { CHAT_DAY_MIN, currentSeason, discordLevel } from '@/lib/dream-pass';
import { passFor, type PassView } from '@/lib/dream-pass-read';

export interface AccountPass extends PassView {
  rank: { name: string; emoji: string; min: number } | null;
  next_rank: { name: string; emoji: string; min: number } | null;
  discord: AccountDiscordLevel;
}

/** Discord ids of an account: staff mapping on the characters + /claim links of the users who claimed them. */
export async function accountDiscordIds(supabase: SupabaseClient, memberIds: string[]): Promise<string[]> {
  const [{ data: members }, { data: claims }] = await Promise.all([
    supabase.from('members').select('discord_id').in('id', memberIds),
    supabase.from('user_characters').select('user_id').in('member_id', memberIds).eq('status', 'approved'),
  ]);
  const users = Array.from(new Set((claims ?? []).map((c) => c.user_id as string)));
  const { data: links } = users.length ? await supabase.from('user_discord_links').select('discord_id').in('user_id', users) : { data: [] };
  return Array.from(new Set([...(members ?? []).map((m) => m.discord_id), ...(links ?? []).map((l) => l.discord_id)].filter(Boolean) as string[]));
}

export interface AccountDiscordLevel {
  linked: boolean;
  xp: number;
  level: number;
  into: number;
  need: number;
  messages: number;
  bumps: number;
  /** Days this month with enough counted messages for Dream Pass chat XP. */
  chat_days_month: number;
}

/** Discord level of an account: counted messages + bumps over all its Discord ids. */
export async function accountDiscordLevel(supabase: SupabaseClient, memberIds: string[]): Promise<AccountDiscordLevel> {
  const discordIds = await accountDiscordIds(supabase, memberIds);
  if (!discordIds.length) return { linked: false, xp: 0, level: 0, into: 0, need: 10, messages: 0, bumps: 0, chat_days_month: 0 };
  const [chat, bumps] = await Promise.all([
    chatStats(supabase, discordIds),
    supabase.from('bumps').select('id', { count: 'exact', head: true }).in('discord_id', discordIds).then((r) => r.count ?? 0),
  ]);
  const messages = discordIds.reduce((s, d) => s + (chat.get(d)?.counted ?? 0), 0);
  const month = currentSeason();
  const days = new Map<string, number>();
  for (const d of discordIds) chat.get(d)?.days.forEach((n, day) => { if (day.startsWith(month)) days.set(day, (days.get(day) ?? 0) + n); });
  const xp = messages + bumps;
  return { linked: true, xp, messages, bumps, chat_days_month: Array.from(days.values()).filter((n) => n >= CHAT_DAY_MIN).length, ...discordLevel(xp) };
}

export async function accountPass(supabase: SupabaseClient, memberIds: string[], season?: string): Promise<AccountPass> {
  const [view, d] = await Promise.all([passFor(supabase, memberIds, season), accountDiscordLevel(supabase, memberIds)]);
  const pick = (r: ReturnType<typeof rankFor>) => (r ? { name: r.name, emoji: r.emoji, min: r.min } : null);
  return {
    ...view,
    rank: pick(rankFor(view.lifetime)),
    next_rank: pick(nextRank(view.lifetime)),
    discord: d,
  };
}
