import type { SupabaseClient } from '@supabase/supabase-js';

type Member = {
  id: string;
  ign: string;
  hashed_id: string | null;
  character_id: number | null;
};

/**
 * Rewrite an account's alt rows so `newMainId` is the representative (main).
 * Walks the full component via member_alts links. All resulting rows are written
 * with source='manual' — an explicit main choice overrides future syncs.
 */
export async function switchAccountMain(
  supabase: SupabaseClient,
  newMainId: string
): Promise<{ account_size: number; rows_written: number; previous_main_id: string | null }> {
  // BFS component via member_alts links
  const visited = new Set<string>([newMainId]);
  const queue: string[] = [newMainId];
  const linkRowIds = new Set<string>();

  while (queue.length > 0) {
    const cur = queue.shift()!;
    const [{ data: fwd }, { data: rev }] = await Promise.all([
      supabase.from('member_alts').select('id, alt_member_id').eq('member_id', cur),
      supabase.from('member_alts').select('id, member_id').eq('alt_member_id', cur),
    ]);
    for (const r of fwd ?? []) {
      linkRowIds.add(r.id);
      if (r.alt_member_id && !visited.has(r.alt_member_id)) {
        visited.add(r.alt_member_id);
        queue.push(r.alt_member_id);
      }
    }
    for (const r of rev ?? []) {
      linkRowIds.add(r.id);
      if (r.member_id && !visited.has(r.member_id)) {
        visited.add(r.member_id);
        queue.push(r.member_id);
      }
    }
  }

  // Find previous main via any surviving row's member_id (before we delete)
  let previousMainId: string | null = null;
  if (linkRowIds.size > 0) {
    const { data: any1 } = await supabase
      .from('member_alts')
      .select('member_id')
      .in('id', Array.from(linkRowIds))
      .limit(1);
    previousMainId = any1?.[0]?.member_id ?? null;
  }

  const memberIds = Array.from(visited);
  if (memberIds.length < 2) {
    return { account_size: memberIds.length, rows_written: 0, previous_main_id: previousMainId };
  }

  const { data: membersRaw } = await supabase
    .from('members')
    .select('id, ign, hashed_id, character_id')
    .in('id', memberIds);
  const members = (membersRaw ?? []) as Member[];
  const byId = new Map(members.map((m) => [m.id, m]));

  // Wipe all existing rows in the component
  if (linkRowIds.size > 0) {
    await supabase.from('member_alts').delete().in('id', Array.from(linkRowIds));
  }

  // Write new rows with newMainId as representative
  const newMain = byId.get(newMainId);
  if (!newMain || !newMain.hashed_id) {
    return { account_size: memberIds.length, rows_written: 0, previous_main_id: previousMainId };
  }

  let rowsWritten = 0;
  for (const m of members) {
    if (m.id === newMainId) continue;
    if (!m.hashed_id) continue;
    const { error } = await supabase.from('member_alts').upsert({
      member_id: newMainId,
      alt_ign: m.ign,
      alt_hashed_id: m.hashed_id,
      alt_character_id: m.character_id ?? null,
      alt_member_id: m.id,
      fetched_at: new Date().toISOString(),
      source: 'manual',
    }, { onConflict: 'member_id,alt_hashed_id' });
    if (!error) rowsWritten++;
  }

  return { account_size: memberIds.length, rows_written: rowsWritten, previous_main_id: previousMainId };
}
