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
