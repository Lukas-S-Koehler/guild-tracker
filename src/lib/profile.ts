/**
 * Member profiles /p/[ign] (Dream Hub step 12, F1). Members-only.
 *
 * A profile is an ACCOUNT, found by any of its characters' IGN: the member_alts closure of that
 * character, same unit as /me and achievements (alts pooled). Works for accounts nobody has
 * claimed on the website too; the title only exists once someone claimed it.
 *
 * Built on the /me summary, minus everything private: no warnings, no daily check / kick status,
 * no bank balance, no holiday, no move-up nudge, and the activity feed only keeps guild joins,
 * assault waves and achievement unlocks.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getBundleCharacters, type AccountCharacter } from '@/lib/account-service';
import { getAccountMemberIds } from '@/lib/alt-graph';
import { buildSummaryFor, type MeSummary } from '@/lib/me-summary';
import { accountProgress, type AccountAchievements } from '@/lib/achievement-eval';
import { TIERS } from '@/lib/achievements';
import { receivedKudos, type ReceivedKudos } from '@/lib/kudos';

export interface ProfileAccount {
  characters: AccountCharacter[];
  /** Website user who claimed this account, if any. */
  userId: string | null;
}

export interface ProfileCharacter {
  member_id: string;
  ign: string;
  avatar_url: string | null;
  class: string | null;
  total_level: number | null;
  combat_level: number | null;
  position: string | null;
  guild_name: string | null;
  guild_nickname: string | null;
  in_dream_guild: boolean;
  main: boolean;
  last_seen: string | null;
}

export interface Profile {
  ign: string;
  /** True when the viewer owns this account (links to /me instead). */
  is_self: boolean;
  /** Someone claimed this account on the website. */
  claimed: boolean;
  main: ProfileCharacter;
  characters: ProfileCharacter[];
  tiles: MeSummary['tiles'];
  /** Account streak, same rule as the leaderboard. */
  streak: MeSummary['streak'];
  character_streaks: MeSummary['character_streaks'];
  heatmap: MeSummary['heatmap'];
  journey: MeSummary['journey'];
  feed: { at: string; kind: 'join' | 'assault' | 'achievement'; title: string; detail?: string; tone: 'good' | 'info' }[];
  achievements: { claimed: true } & AccountAchievements;
  /** Kudos received by the whole account (step 14). */
  kudos: ReceivedKudos;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Account bundle for a character IGN (case-insensitive). Prefers an active character on name clashes. */
export async function findProfileAccount(ign: string, supabase: SupabaseClient): Promise<ProfileAccount | null> {
  const name = ign.trim();
  if (!name || name.length > 40) return null;
  const { data: hits } = await supabase
    .from('members')
    .select('id, is_active')
    .ilike('ign', escapeLike(name))
    .order('is_active', { ascending: false })
    .limit(1);
  const seed = hits?.[0]?.id as string | undefined;
  if (!seed) return null;

  const ids = Array.from(await getAccountMemberIds(supabase, [seed]));
  const { data: claims } = await supabase
    .from('user_characters')
    .select('user_id, member_id')
    .in('member_id', ids)
    .eq('status', 'approved');
  const claimedSet = new Set((claims ?? []).map((c) => c.member_id as string));
  const characters = await getBundleCharacters(ids, claimedSet, supabase);
  if (!characters.length) return null;
  return { characters, userId: (claims?.[0]?.user_id as string | undefined) ?? null };
}

export async function buildProfile(
  account: ProfileAccount,
  viewerId: string,
  supabase: SupabaseClient
): Promise<Profile> {
  const { characters, userId } = account;
  const ids = characters.map((c) => c.member_id);
  const [s, achievements, kudos] = await Promise.all([
    buildSummaryFor(characters, {}, supabase),
    accountProgress(supabase, ids, userId),
    receivedKudos(supabase, ids, 8).catch(() => ({ total: 0, this_week: 0, givers: 0, recent: [] })),
  ]);

  const toChar = (c: MeSummary['characters'][number]): ProfileCharacter => ({
    member_id: c.member_id,
    ign: c.ign,
    avatar_url: c.avatar_url,
    class: c.class,
    total_level: c.total_level,
    combat_level: c.combat_level,
    position: c.in_dream_guild ? c.position : null,
    guild_name: c.in_dream_guild ? c.guild_name : null,
    guild_nickname: c.in_dream_guild ? c.guild_nickname : null,
    in_dream_guild: c.in_dream_guild,
    main: c.member_id === s.main.member_id,
    last_seen: c.last_seen,
  });

  const feed: Profile['feed'] = s.feed
    .filter((f) => f.kind === 'join' || f.kind === 'assault')
    .map((f) => ({ at: f.at, kind: f.kind as 'join' | 'assault', title: f.title, detail: f.detail, tone: 'info' as const }));
  for (const a of achievements.achievements) {
    if (!a.unlocked_at) continue;
    feed.push({ at: a.unlocked_at, kind: 'achievement', title: `${TIERS[a.tier].emoji} ${a.name}`, detail: a.description, tone: 'good' });
  }
  feed.sort((a, b) => b.at.localeCompare(a.at));

  return {
    ign: s.main.ign,
    is_self: !!userId && userId === viewerId,
    claimed: !!userId,
    main: toChar(s.main),
    characters: s.characters.map(toChar),
    tiles: s.tiles,
    streak: s.streak,
    character_streaks: s.character_streaks,
    heatmap: s.heatmap,
    journey: s.journey,
    feed: feed.slice(0, 20),
    // Locked hidden achievements are already masked by accountProgress.
    achievements: { claimed: true, ...achievements },
    kudos,
  };
}

/** Route params may arrive still encoded; never throw on a stray '%'. */
export function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
