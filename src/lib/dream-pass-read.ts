/**
 * Dream Pass reads (step 15): the numbers /me, profiles, Discord and the role sync show.
 * Kept apart from the evaluator so the role sync can import it without pulling in the chat reader.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { LIFETIME, currentSeason, passLevel, previousSeason, type Breakdown } from '@/lib/dream-pass';

const PAGE = 1000;
const chunks = <T,>(arr: T[], n = 200): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

export interface Standing { place: number; member_id: string; member_ids: string[]; ign: string; xp: number; level: number; discord_id: string | null }

// ─── Reads (/me, profile, Discord) ───────────────────────────────────────────

export interface PassView {
  season: string;
  xp: number;
  level: ReturnType<typeof passLevel>;
  breakdown: Breakdown;
  /** Place on this season's board (accounts), null without XP. */
  place: number | null;
  players: number;
  lifetime: number;
  lifetime_breakdown: Breakdown;
  lifetime_place: number | null;
  /** Finished seasons this account placed top 10 in. */
  champion: Array<{ season: string; place: number }>;
  previous: { season: string; xp: number; level: number } | null;
}

/** Pass numbers for the account of `memberIds` (any character works). */
export async function passFor(supabase: SupabaseClient, memberIds: string[], season = currentSeason()): Promise<PassView> {
  const prev = previousSeason(season);
  const { data } = await supabase.from('dream_pass_scores').select('season, xp, level, breakdown').in('member_id', memberIds).in('season', [season, prev, LIFETIME]);
  const pick = (s: string) => (data ?? []).filter((r) => r.season === s).sort((a, b) => b.xp - a.xp)[0];
  const cur = pick(season);
  const life = pick(LIFETIME);
  const prevRow = pick(prev);
  const placeOf = async (s: string, xp: number | undefined) => {
    if (!xp) return null;
    const { count } = await supabase.from('dream_pass_scores').select('member_id', { count: 'exact', head: true }).eq('season', s).eq('is_main', true).gt('xp', xp);
    return (count ?? 0) + 1;
  };
  const [place, lifetimePlace, players, seasons] = await Promise.all([
    placeOf(season, cur?.xp),
    placeOf(LIFETIME, life?.xp),
    supabase.from('dream_pass_scores').select('member_id', { count: 'exact', head: true }).eq('season', season).eq('is_main', true).gt('xp', 0).then((r) => r.count ?? 0),
    supabase.from('dream_pass_seasons').select('season, standings').order('season', { ascending: false }).limit(24),
  ]);
  const ids = new Set(memberIds);
  const champion = (seasons.data ?? []).flatMap((s) => {
    const hit = ((s.standings ?? []) as Standing[]).find((x) => x.member_ids?.some((id) => ids.has(id)));
    return hit ? [{ season: s.season as string, place: hit.place }] : [];
  });
  const xp = cur?.xp ?? 0;
  return {
    season,
    xp,
    level: passLevel(xp),
    breakdown: (cur?.breakdown ?? {}) as Breakdown,
    place,
    players,
    lifetime: life?.xp ?? 0,
    lifetime_breakdown: (life?.breakdown ?? {}) as Breakdown,
    lifetime_place: lifetimePlace,
    champion,
    previous: prevRow ? { season: prev, xp: prevRow.xp, level: prevRow.level } : null,
  };
}

/** Lifetime Dream XP per member id (every character of an account carries the account total). */
export async function lifetimeXpByMember(supabase: SupabaseClient, memberIds?: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const load = (ids: string[] | null) =>
    (async () => {
      const out: Array<{ member_id: string; xp: number }> = [];
      for (let from = 0; ; from += PAGE) {
        let q = supabase.from('dream_pass_scores').select('member_id, xp').eq('season', LIFETIME).order('member_id').range(from, from + PAGE - 1);
        if (ids) q = q.in('member_id', ids);
        const { data, error } = await q;
        if (error) return out; // migration not run yet
        out.push(...((data ?? []) as Array<{ member_id: string; xp: number }>));
        if (!data || data.length < PAGE) return out;
      }
    })();
  const rows = memberIds ? (await Promise.all(chunks(memberIds).map(load))).flat() : await load(null);
  for (const r of rows) out.set(r.member_id, r.xp);
  return out;
}

/** Newest finished season (for the champion role), or null. */
export async function latestChampions(supabase: SupabaseClient): Promise<{ season: string; standings: Standing[] } | null> {
  const { data, error } = await supabase.from('dream_pass_seasons').select('season, standings').order('season', { ascending: false }).limit(1).maybeSingle();
  if (error || !data) return null;
  return { season: data.season as string, standings: (data.standings ?? []) as Standing[] };
}
