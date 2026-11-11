import type { SupabaseClient } from '@supabase/supabase-js';
import type { IdleMMOApi } from './idlemmo-api';

type Member = {
  id: string;
  ign: string;
  hashed_id: string | null;
  current_guild_id: string | null;
  character_id: number | null;
  discord_id: string | null;
  discord_username: string | null;
};

type ApiChar = { id: number; hashed_id: string; name: string };

export type AltSyncResult = {
  processed: number;
  components: number;
  alt_links_written: number;
  manual_preserved: number;
  errors: string[];
  debug: string[];
};

export type RunAltSyncArgs = {
  supabase: SupabaseClient;
  api: IdleMMOApi;
  /** Hashed IDs to fetch from API (seed set — e.g., the guild's members). */
  seedHashedIds: string[];
  /** If set, only components that include at least one member in this guild are written. */
  scopeGuildId?: string;
  /** Delay between API calls, ms. */
  apiDelayMs?: number;
};

/**
 * Rebuild sync-derived alt links while preserving manual rows.
 *
 * Manual rows are treated as authoritative edges in the alt graph and are never deleted by sync.
 * Sync rows are rewritten every call for the components it touches.
 */
export async function runAltSync(args: RunAltSyncArgs): Promise<AltSyncResult> {
  const { supabase, api, seedHashedIds, scopeGuildId, apiDelayMs = 200 } = args;
  const debug: string[] = [];
  const errors: string[] = [];

  const { data: allMembersRaw } = await supabase
    .from('members')
    .select('id, ign, hashed_id, character_id, current_guild_id, discord_id, discord_username')
    .eq('is_active', true)
    .not('hashed_id', 'is', null);
  const allMembers = (allMembersRaw ?? []) as Member[];
  const hashedIdToMember = new Map<string, Member>(
    allMembers.filter((m) => m.hashed_id).map((m) => [m.hashed_id!, m])
  );
  const idToMember = new Map<string, Member>(allMembers.map((m) => [m.id, m]));

  // Manual rows globally — they define permanent edges.
  const { data: manualRowsRaw } = await supabase
    .from('member_alts')
    .select('id, member_id, alt_ign, alt_hashed_id, alt_character_id, alt_member_id')
    .eq('source', 'manual');
  const manualRows = manualRowsRaw ?? [];

  const altGraph = new Map<string, Set<string>>();
  const addEdge = (a: string, b: string) => {
    if (!altGraph.has(a)) altGraph.set(a, new Set());
    if (!altGraph.has(b)) altGraph.set(b, new Set());
    altGraph.get(a)!.add(b);
    altGraph.get(b)!.add(a);
  };
  const charInfoMap = new Map<string, { id: number | null; name: string; hashed_id: string }>();

  // Manual edges
  for (const row of manualRows) {
    const main = idToMember.get(row.member_id);
    if (!main?.hashed_id || !row.alt_hashed_id) continue;
    addEdge(main.hashed_id, row.alt_hashed_id);
    if (!charInfoMap.has(row.alt_hashed_id)) {
      charInfoMap.set(row.alt_hashed_id, {
        id: row.alt_character_id ?? null,
        name: row.alt_ign,
        hashed_id: row.alt_hashed_id,
      });
    }
  }

  // Shared-discord-id edges: members with same non-null discord_id are alts.
  const byDiscord = new Map<string, Member[]>();
  for (const m of allMembers) {
    if (!m.discord_id || !m.hashed_id) continue;
    const arr = byDiscord.get(m.discord_id) ?? [];
    arr.push(m);
    byDiscord.set(m.discord_id, arr);
  }
  for (const group of Array.from(byDiscord.values())) {
    if (group.length < 2) continue;
    const anchor = group[0].hashed_id!;
    for (let i = 1; i < group.length; i++) {
      addEdge(anchor, group[i].hashed_id!);
    }
    for (const m of group) {
      if (!charInfoMap.has(m.hashed_id!) && m.character_id != null) {
        charInfoMap.set(m.hashed_id!, { id: m.character_id, name: m.ign, hashed_id: m.hashed_id! });
      }
    }
  }

  // Seed self-nodes (so lone tracked members still form a component)
  for (const h of seedHashedIds) {
    if (!altGraph.has(h)) altGraph.set(h, new Set());
    const m = hashedIdToMember.get(h);
    if (m?.character_id != null && !charInfoMap.has(h)) {
      charInfoMap.set(h, { id: m.character_id, name: m.ign, hashed_id: h });
    }
  }

  // Phase 1: fetch API edges
  let processed = 0;
  const seen = new Set<string>();
  for (const hashed of seedHashedIds) {
    if (seen.has(hashed)) continue;
    seen.add(hashed);
    try {
      const chars = (await api.getCharacterAlts(hashed)) as ApiChar[];
      processed++;
      for (const c of chars) {
        charInfoMap.set(c.hashed_id, { id: c.id, name: c.name, hashed_id: c.hashed_id });
        addEdge(hashed, c.hashed_id);
        const tracked = hashedIdToMember.get(c.hashed_id);
        if (tracked && tracked.character_id == null) {
          await supabase.from('members').update({ character_id: c.id }).eq('id', tracked.id);
          tracked.character_id = c.id;
        }
      }
      const self = hashedIdToMember.get(hashed);
      if (self?.character_id != null && !charInfoMap.has(hashed)) {
        charInfoMap.set(hashed, { id: self.character_id, name: self.ign, hashed_id: hashed });
      }
      if (apiDelayMs > 0) await new Promise((r) => setTimeout(r, apiDelayMs));
    } catch (err) {
      const self = hashedIdToMember.get(hashed);
      errors.push(`${self?.ign ?? hashed.slice(0, 8)}: ${String(err)}`);
    }
  }

  // Phase 2: union-find
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    if (!parent.has(x)) parent.set(x, x);
    if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!));
    return parent.get(x)!;
  };
  const union = (a: string, b: string) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const [src, dsts] of Array.from(altGraph.entries())) {
    for (const dst of Array.from(dsts)) union(src, dst);
  }
  const components = new Map<string, Set<string>>();
  for (const h of Array.from(altGraph.keys())) {
    const root = find(h);
    if (!components.has(root)) components.set(root, new Set());
    components.get(root)!.add(h);
  }

  let altLinksWritten = 0;
  let manualPreserved = 0;

  for (const comp of Array.from(components.values())) {
    const allHashedIds = Array.from(comp);
    const allTracked = allHashedIds
      .map((h) => hashedIdToMember.get(h))
      .filter((m): m is Member => !!m);
    if (allTracked.length === 0) continue;

    if (scopeGuildId && !allTracked.some((m) => m.current_guild_id === scopeGuildId)) continue;

    // Representative = tracked member with lowest numeric character_id
    let representative: Member | undefined;
    let lowestId = Infinity;
    for (const m of allTracked) {
      const info = charInfoMap.get(m.hashed_id!);
      const numId = info?.id ?? m.character_id ?? Infinity;
      if (numId < lowestId) { lowestId = numId; representative = m; }
    }
    if (!representative) representative = allTracked[0];
    const trackedIds = allTracked.map((m) => m.id);

    // Delete sync rows for all tracked members in this component (both directions)
    await Promise.all([
      supabase.from('member_alts').delete().eq('source', 'sync').in('member_id', trackedIds),
      supabase.from('member_alts').delete().eq('source', 'sync').in('alt_member_id', trackedIds),
    ]);

    // Rebase manual rows to current representative; fix alt_member_id if tracked
    const { data: compManual } = await supabase
      .from('member_alts')
      .select('id, member_id, alt_hashed_id, alt_member_id')
      .eq('source', 'manual')
      .in('member_id', trackedIds);
    const manualPairs = new Set<string>();
    for (const row of compManual ?? []) {
      const altMember = row.alt_hashed_id ? hashedIdToMember.get(row.alt_hashed_id) : null;
      const needsRebase = row.member_id !== representative.id;
      const needsAltFix = (altMember?.id ?? null) !== row.alt_member_id;
      if (needsRebase || needsAltFix) {
        await supabase.from('member_alts').update({
          member_id: representative.id,
          alt_member_id: altMember?.id ?? null,
        }).eq('id', row.id);
      }
      manualPairs.add(`${representative.id}::${row.alt_hashed_id}`);
      manualPreserved++;
    }
    // Also rebase manual rows where the alt is in this component but main isn't in trackedIds anymore
    const { data: revManual } = await supabase
      .from('member_alts')
      .select('id, member_id, alt_hashed_id, alt_member_id')
      .eq('source', 'manual')
      .in('alt_member_id', trackedIds);
    for (const row of revManual ?? []) {
      if (trackedIds.includes(row.member_id)) continue; // already handled above
      // main is outside tracked set — leave alone
      void row;
    }

    // Insert sync rows: representative → every other hashed_id in component
    for (const h of allHashedIds) {
      if (h === representative.hashed_id) continue;
      const pairKey = `${representative.id}::${h}`;
      if (manualPairs.has(pairKey)) continue;
      const info = charInfoMap.get(h);
      if (!info) continue;
      const altMember = hashedIdToMember.get(h);
      const { error } = await supabase.from('member_alts').insert({
        member_id: representative.id,
        alt_ign: info.name,
        alt_hashed_id: info.hashed_id,
        alt_character_id: info.id ?? null,
        alt_member_id: altMember?.id ?? null,
        fetched_at: new Date().toISOString(),
        source: 'sync',
      });
      if (error) {
        errors.push(`insert ${representative.ign}→${info.name}: ${error.message}`);
      } else {
        altLinksWritten++;
      }
    }

    // Discord propagate within tracked set
    const discordSource = allTracked.find((m) => m.discord_id != null);
    if (discordSource) {
      for (const m of allTracked) {
        if (m.id === discordSource.id || m.discord_id != null) continue;
        await supabase.from('members').update({
          discord_id: discordSource.discord_id,
          discord_username: discordSource.discord_username ?? null,
        }).eq('id', m.id);
      }
    }
  }

  return {
    processed,
    components: components.size,
    alt_links_written: altLinksWritten,
    manual_preserved: manualPreserved,
    errors,
    debug,
  };
}
