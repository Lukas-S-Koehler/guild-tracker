import type { SupabaseClient } from '@supabase/supabase-js';

export const MARKET_LOCKED_CLASSES = ['Banished', 'Cursed'] as const;

export function isMarketLocked(cls?: string | null): boolean {
  if (!cls) return false;
  const lower = cls.toLowerCase();
  return MARKET_LOCKED_CLASSES.some((c) => c.toLowerCase() === lower);
}

export type LeaderboardFilter = 'all' | 'locked' | 'non-locked';
export type LeaderboardPeriod = 'week' | 'month' | 'all';

export interface LeaderboardRow {
  id: string;
  ign: string;
  class: string | null;
  guild_nickname: string | null;
  guild_name: string | null;
  current_guild_id: string;
  total_raids: number;
  total_gold: number;
  activity_score: number;
  days_active: number;
}

export interface LeaderboardEntry extends LeaderboardRow {
  alt_count: number;
  alt_igns: string[];
  alt_locked_count?: number;
  is_alt?: boolean;
  main_ign?: string | null;
}

interface FetchArgs {
  supabase: SupabaseClient;
  period: LeaderboardPeriod;
  guildFilter?: string | null;
  merged: boolean;
  filter: LeaderboardFilter;
}

function viewFor(period: LeaderboardPeriod): string {
  switch (period) {
    case 'week': return 'v_weekly_leaderboard';
    case 'month': return 'v_monthly_leaderboard';
    case 'all': return 'v_global_leaderboard';
  }
}

function matchesFilter(cls: string | null | undefined, filter: LeaderboardFilter): boolean {
  if (filter === 'all') return true;
  const locked = isMarketLocked(cls);
  return filter === 'locked' ? locked : !locked;
}

export async function fetchLeaderboard({
  supabase, period, guildFilter, merged, filter,
}: FetchArgs): Promise<LeaderboardEntry[]> {
  let query = supabase.from(viewFor(period)).select('*');
  if (guildFilter && guildFilter !== 'all') {
    query = query.eq('current_guild_id', guildFilter);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const entries = (data ?? []) as LeaderboardRow[];

  if (!merged) {
    const filtered = entries.filter((e) => matchesFilter(e.class, filter));
    const memberIds = filtered.map((e) => e.id);
    if (memberIds.length === 0) return [];

    const { data: revLinks } = await supabase
      .from('member_alts')
      .select('member_id, alt_member_id')
      .in('alt_member_id', memberIds);

    const altToMainId = new Map<string, string>();
    for (const link of revLinks ?? []) {
      if (link.alt_member_id) altToMainId.set(link.alt_member_id, link.member_id);
    }

    const mainIds = Array.from(new Set(Array.from(altToMainId.values())));
    const mainIgnMap = new Map<string, string>();
    if (mainIds.length > 0) {
      const { data: mainMembers } = await supabase
        .from('members')
        .select('id, ign')
        .in('id', mainIds);
      for (const m of mainMembers ?? []) mainIgnMap.set(m.id, m.ign);
      for (const e of filtered) mainIgnMap.set(e.id, e.ign);
    }

    return filtered.map((e) => {
      const mainId = altToMainId.get(e.id);
      return {
        ...e,
        alt_count: 0,
        alt_igns: [],
        is_alt: !!mainId,
        main_ign: mainId ? (mainIgnMap.get(mainId) ?? null) : null,
      };
    });
  }

  // Merged mode
  const memberIds = entries.map((e) => e.id);
  if (memberIds.length === 0) return [];

  const [{ data: altLinks }, { data: reverseAltLinks }] = await Promise.all([
    supabase
      .from('member_alts')
      .select('member_id, alt_member_id, alt_ign, alt_hashed_id')
      .in('member_id', memberIds),
    supabase
      .from('member_alts')
      .select('member_id, alt_member_id, alt_ign, alt_hashed_id')
      .in('alt_member_id', memberIds),
  ]);

  const externalMainIds = Array.from(new Set(
    (reverseAltLinks ?? [])
      .map((l) => l.member_id)
      .filter((id) => !memberIds.includes(id))
  ));

  let externalLinks: Array<{
    member_id: string;
    alt_member_id: string | null;
    alt_ign: string;
    alt_hashed_id: string | null;
  }> = [];

  if (externalMainIds.length > 0) {
    const { data } = await supabase
      .from('member_alts')
      .select('member_id, alt_member_id, alt_ign, alt_hashed_id')
      .in('member_id', externalMainIds);
    externalLinks = data ?? [];
  }

  const allLinks = [...(altLinks ?? []), ...(reverseAltLinks ?? []), ...externalLinks];

  const parent = new Map<string, string>();
  function find(id: string): string {
    if (!parent.has(id)) parent.set(id, id);
    const p = parent.get(id)!;
    if (p === id) return id;
    const root = find(p);
    parent.set(id, root);
    return root;
  }
  function union(mainMemberId: string, altMemberId: string) {
    const rm = find(mainMemberId);
    const ra = find(altMemberId);
    if (rm === ra) return;
    parent.set(ra, rm);
  }

  for (const link of allLinks) {
    if (link.alt_member_id && memberIds.includes(link.alt_member_id)) {
      union(link.member_id, link.alt_member_id);
    }
  }

  // Fetch alt classes for market-locked annotation (named/untracked alts have hashed_id but no members row)
  // We only annotate tracked alt member classes here; untracked ones lack class info.
  const groups = new Map<string, LeaderboardRow[]>();
  for (const entry of entries) {
    const canonical = find(entry.id);
    const group = groups.get(canonical) ?? [];
    group.push(entry);
    groups.set(canonical, group);
  }

  const merged_entries: LeaderboardEntry[] = Array.from(groups.entries()).map(([canonicalId, group]) => {
    const main = group.find((e) => e.id === canonicalId) ?? group[0];
    const alts = group.filter((e) => e.id !== main.id);

    const namedAltsMap = new Map<string, string>();
    for (const link of allLinks) {
      if (find(link.member_id) !== find(main.id)) continue;
      if (memberIds.includes(link.alt_member_id ?? '')) continue;
      if (link.alt_hashed_id) {
        namedAltsMap.set(link.alt_hashed_id, link.alt_ign);
      }
    }
    const namedAltIgns = Array.from(namedAltsMap.values());
    const altLockedCount = alts.filter((a) => isMarketLocked(a.class)).length;

    return {
      ...main,
      total_raids: group.reduce((s, e) => s + (e.total_raids ?? 0), 0),
      total_gold: group.reduce((s, e) => s + (e.total_gold ?? 0), 0),
      activity_score: group.reduce((s, e) => s + (e.activity_score ?? 0), 0),
      days_active: Math.max(...group.map((e) => e.days_active ?? 0)),
      alt_count: alts.length + namedAltIgns.length,
      alt_igns: [...alts.map((a) => a.ign), ...namedAltIgns],
      alt_locked_count: altLockedCount,
    };
  });

  const filtered = merged_entries.filter((e) => matchesFilter(e.class, filter));
  filtered.sort((a, b) => b.activity_score - a.activity_score);
  return filtered;
}
