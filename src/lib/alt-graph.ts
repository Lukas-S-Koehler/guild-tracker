import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Full transitive closure over member_alts (both directions), batched BFS.
 * Returns every member id in the same account as any seed (seeds included).
 * No hop or size cap — accounts can have up to 5 characters across guilds.
 *
 * Rows are matched by alt_member_id AND alt_hashed_id, because rows written
 * before the alt was tracked can have alt_member_id = null.
 */
export async function getAccountMemberIds(
  supabase: SupabaseClient,
  seedIds: string[]
): Promise<Set<string>> {
  const visited = new Set<string>(seedIds);
  let frontier = [...seedIds];
  while (frontier.length > 0) {
    const { data: fm } = await supabase.from('members').select('id, hashed_id').in('id', frontier);
    const frontierHashes = (fm ?? []).map((m) => m.hashed_id).filter(Boolean) as string[];

    const cols = 'member_id, alt_member_id, alt_hashed_id';
    const queries = [
      supabase.from('member_alts').select(cols).in('member_id', frontier),
      supabase.from('member_alts').select(cols).in('alt_member_id', frontier),
    ];
    if (frontierHashes.length > 0) {
      queries.push(supabase.from('member_alts').select(cols).in('alt_hashed_id', frontierHashes));
    }
    const results = await Promise.all(queries);
    const rows = results.flatMap((r) => r.data ?? []);

    // Resolve alt hashes with no alt_member_id to tracked members
    const unresolved = Array.from(
      new Set(rows.filter((r) => !r.alt_member_id && r.alt_hashed_id).map((r) => r.alt_hashed_id as string))
    );
    const hashToId = new Map<string, string>();
    if (unresolved.length > 0) {
      const { data: byHash } = await supabase.from('members').select('id, hashed_id').in('hashed_id', unresolved);
      for (const m of byHash ?? []) if (m.hashed_id) hashToId.set(m.hashed_id, m.id);
    }

    const next: string[] = [];
    for (const r of rows) {
      const altId = r.alt_member_id ?? (r.alt_hashed_id ? hashToId.get(r.alt_hashed_id) : undefined);
      for (const id of [r.member_id, altId]) {
        if (id && !visited.has(id)) {
          visited.add(id);
          next.push(id);
        }
      }
    }
    frontier = next;
  }
  return visited;
}

/**
 * Batched account grouping for many characters at once (officer report, auto-warn).
 * Walks the full member_alts closure like getAccountMemberIds, so two characters linked
 * only through a third (e.g. both alts of a main in another guild) land in one account.
 * Returns a Map from every seed id to its account key (the smallest member id in the
 * account); seeds without links map to themselves.
 */
export async function getAccountKeys(
  supabase: SupabaseClient,
  seedIds: string[]
): Promise<Map<string, string>> {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = x;
    while (c !== r) { const n = parent.get(c)!; parent.set(c, r); c = n; }
    return r;
  };
  const add = (x: string) => { if (!parent.has(x)) parent.set(x, x); };
  const union = (a: string, b: string) => {
    add(a); add(b);
    const ra = find(a), rb = find(b);
    if (ra !== rb) { if (ra < rb) parent.set(rb, ra); else parent.set(ra, rb); }
  };

  seedIds.forEach(add);
  const visited = new Set<string>(seedIds);
  let frontier = [...seedIds];
  const chunk = <T,>(arr: T[], n = 200) => {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
  };

  while (frontier.length > 0) {
    const next: string[] = [];
    for (const part of chunk(frontier)) {
      const { data: fm } = await supabase.from('members').select('id, hashed_id').in('id', part);
      const hashes = (fm ?? []).map((m) => m.hashed_id).filter(Boolean) as string[];
      const cols = 'member_id, alt_member_id, alt_hashed_id';
      const queries = [
        supabase.from('member_alts').select(cols).in('member_id', part),
        supabase.from('member_alts').select(cols).in('alt_member_id', part),
      ];
      if (hashes.length > 0) queries.push(supabase.from('member_alts').select(cols).in('alt_hashed_id', hashes));
      const rows = (await Promise.all(queries)).flatMap((r) => r.data ?? []);

      const unresolved = Array.from(
        new Set(rows.filter((r) => !r.alt_member_id && r.alt_hashed_id).map((r) => r.alt_hashed_id as string))
      );
      const hashToId = new Map<string, string>();
      if (unresolved.length > 0) {
        const { data: byHash } = await supabase.from('members').select('id, hashed_id').in('hashed_id', unresolved);
        for (const m of byHash ?? []) if (m.hashed_id) hashToId.set(m.hashed_id, m.id);
      }

      for (const r of rows) {
        const altId = r.alt_member_id ?? (r.alt_hashed_id ? hashToId.get(r.alt_hashed_id) : undefined);
        if (!altId || !r.member_id) continue;
        union(r.member_id, altId);
        for (const id of [r.member_id, altId]) {
          if (!visited.has(id)) { visited.add(id); next.push(id); }
        }
      }
    }
    frontier = next;
  }

  const out = new Map<string, string>();
  for (const id of seedIds) out.set(id, find(id));
  return out;
}

/**
 * Same-guild alt groups as main → alts / alt → main maps (the shape the officer report and
 * auto-warn already use). Groups come from the full account closure, limited to `members`;
 * the group's main is the character with the lowest character_id (oldest character).
 */
export async function getSameGuildAltMaps(
  supabase: SupabaseClient,
  members: Array<{ id: string; character_id?: number | null }>
): Promise<{ mainToAlts: Map<string, string[]>; altToMain: Map<string, string> }> {
  const keys = await getAccountKeys(supabase, members.map((m) => m.id));
  const groups = new Map<string, Array<{ id: string; character_id?: number | null }>>();
  for (const m of members) {
    const k = keys.get(m.id) ?? m.id;
    const arr = groups.get(k) ?? [];
    arr.push(m);
    groups.set(k, arr);
  }
  const mainToAlts = new Map<string, string[]>();
  const altToMain = new Map<string, string>();
  for (const g of Array.from(groups.values())) {
    if (g.length < 2) continue;
    g.sort((a, b) => (a.character_id ?? Infinity) - (b.character_id ?? Infinity) || (a.id < b.id ? -1 : 1));
    const main = g[0]!.id;
    const alts = g.slice(1).map((m) => m.id);
    mainToAlts.set(main, alts);
    for (const a of alts) altToMain.set(a, main);
  }
  return { mainToAlts, altToMain };
}

/**
 * The account's main: the `member_id` side of its member_alts rows (what set-main writes).
 * Rows with source='manual' win over synced ones; among equals the most-linked main wins.
 * Returns null when no character of the bundle has alt rows (single-character accounts).
 */
export async function getDesignatedMainId(
  supabase: SupabaseClient,
  bundleIds: string[]
): Promise<string | null> {
  if (bundleIds.length === 0) return null;
  const { data } = await supabase
    .from('member_alts')
    .select('member_id, source')
    .in('member_id', bundleIds);
  const score = new Map<string, number>();
  for (const r of data ?? []) {
    const id = r.member_id as string;
    score.set(id, (score.get(id) ?? 0) + (r.source === 'manual' ? 1000 : 1));
  }
  let best: string | null = null;
  for (const [id, s] of Array.from(score)) if (best === null || s > score.get(best)!) best = id;
  return best;
}

/** Every designated main (member_alts.member_id) with a weight: manual rows count far more. */
export async function getDesignatedMainWeights(supabase: SupabaseClient): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase
      .from('member_alts')
      .select('member_id, source')
      .order('id')
      .range(from, from + 999);
    for (const r of data ?? []) {
      const id = r.member_id as string;
      out.set(id, (out.get(id) ?? 0) + (r.source === 'manual' ? 1000 : 1));
    }
    if (!data || data.length < 1000) break;
  }
  return out;
}
