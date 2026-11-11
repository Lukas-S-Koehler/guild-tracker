import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Ensure manual alt links exist for every pair of tracked members sharing a discord_id.
 * Representative = member with lowest character_id. Other members become alts of the representative.
 *
 * Returns the number of manual rows created (or already present).
 */
export async function linkAltsBySharedDiscord(
  supabase: SupabaseClient,
  discordId: string
): Promise<{ created: number; representative_id: string | null; account_size: number }> {
  if (!discordId) return { created: 0, representative_id: null, account_size: 0 };

  const { data: members } = await supabase
    .from('members')
    .select('id, ign, hashed_id, character_id')
    .eq('discord_id', discordId)
    .eq('is_active', true)
    .not('hashed_id', 'is', null);

  const group = members ?? [];
  if (group.length < 2) return { created: 0, representative_id: group[0]?.id ?? null, account_size: group.length };

  const sorted = [...group].sort((a, b) => (a.character_id ?? Infinity) - (b.character_id ?? Infinity));
  const rep = sorted[0];

  // Remove any conflicting sync rows between members of this group (either direction)
  const groupIds = group.map((g) => g.id);
  const groupHashes = group.map((g) => g.hashed_id).filter(Boolean) as string[];
  if (groupIds.length > 0 && groupHashes.length > 0) {
    await supabase
      .from('member_alts')
      .delete()
      .eq('source', 'sync')
      .in('member_id', groupIds)
      .in('alt_hashed_id', groupHashes);
  }

  let created = 0;
  for (const m of sorted.slice(1)) {
    const { error } = await supabase.from('member_alts').upsert({
      member_id: rep.id,
      alt_ign: m.ign,
      alt_hashed_id: m.hashed_id,
      alt_character_id: m.character_id ?? null,
      alt_member_id: m.id,
      fetched_at: new Date().toISOString(),
      source: 'manual',
    }, { onConflict: 'member_id,alt_hashed_id' });
    if (!error) created++;
  }
  return { created, representative_id: rep.id, account_size: group.length };
}
