/**
 * Dream Pass card data for one account (step 15): season pass + lifetime Dream XP + rank + Discord level.
 * Used by /api/me/pass, /api/profile/[ign]/pass and Discord /pass.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { nextRank, rankFor } from '@/lib/achievement-ranks';
import { chatStats } from '@/lib/discord-chat';
import { discordLevel } from '@/lib/dream-pass';
import { passFor, type PassView } from '@/lib/dream-pass-read';

export interface AccountPass extends PassView {
  rank: { name: string; emoji: string; min: number } | null;
  next_rank: { name: string; emoji: string; min: number } | null;
  discord: { linked: boolean; xp: number; level: number; into: number; need: number; messages: number; bumps: number };
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

export async function accountPass(supabase: SupabaseClient, memberIds: string[]): Promise<AccountPass> {
  const discordIds = await accountDiscordIds(supabase, memberIds);
  const [view, chat, bumps] = await Promise.all([
    passFor(supabase, memberIds),
    discordIds.length ? chatStats(supabase, discordIds) : Promise.resolve(new Map()),
    discordIds.length
      ? supabase.from('bumps').select('id', { count: 'exact', head: true }).in('discord_id', discordIds).then((r) => r.count ?? 0)
      : Promise.resolve(0),
  ]);
  const messages = discordIds.reduce((s, d) => s + (chat.get(d)?.counted ?? 0), 0);
  const dxp = messages + bumps;
  const pick = (r: ReturnType<typeof rankFor>) => (r ? { name: r.name, emoji: r.emoji, min: r.min } : null);
  return {
    ...view,
    rank: pick(rankFor(view.lifetime)),
    next_rank: pick(nextRank(view.lifetime)),
    discord: { linked: discordIds.length > 0, xp: dxp, messages, bumps, ...discordLevel(dxp) },
  };
}
