import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { verifySuperAdmin, isErrorResponse } from '@/lib/auth-helpers';
import { IdleMMOApi } from '@/lib/idlemmo-api';

const SUPER_ADMIN_USER_ID = '5f33bb41-86ab-4024-a1da-6a2fea5fb36b';

// POST /api/admin/sync-alts-all — sync alt characters for ALL guilds using super admin API key
export async function POST(req: NextRequest) {
  const auth = await verifySuperAdmin(req);
  if (isErrorResponse(auth)) return auth;

  const supabase = createAdminClient();

  const { data: keyRow } = await supabase
    .from('user_api_keys')
    .select('api_key')
    .eq('user_id', SUPER_ADMIN_USER_ID)
    .single();

  if (!keyRow?.api_key) {
    return NextResponse.json({ error: 'No API key found for super admin. Add your IdleMMO API key in your profile settings.' }, { status: 400 });
  }

  const api = new IdleMMOApi(keyRow.api_key);

  const { data: allMembers, error: allMembersError } = await supabase
    .from('members')
    .select('id, ign, hashed_id, current_guild_id, character_id, discord_id, discord_username')
    .eq('is_active', true)
    .not('hashed_id', 'is', null);

  if (allMembersError) return NextResponse.json({ error: allMembersError.message }, { status: 500 });

  const hashedIdToMember = new Map(
    (allMembers ?? []).map((m) => [m.hashed_id, m])
  );

  const activeMembers = (allMembers ?? []).filter((m) => m.current_guild_id != null);

  const debugLog: string[] = [];
  debugLog.push(`=== SYNC START: ${activeMembers.length} active members, ${allMembers?.length ?? 0} total tracked ===`);

  // Phase 0: orphan cleanup — delete alt links where member is no longer active
  const activeIds = (allMembers ?? []).map((m) => m.id);
  if (activeIds.length > 0) {
    const [orphanFwd, orphanRev] = await Promise.all([
      supabase.from('member_alts').delete().not('member_id', 'in', `(${activeIds.join(',')})`).select('id'),
      supabase.from('member_alts').delete().not('alt_member_id', 'is', null).not('alt_member_id', 'in', `(${activeIds.join(',')})`).select('id'),
    ]);
    debugLog.push(`P0 orphan cleanup: fwd=${orphanFwd.data?.length ?? 0} rev=${orphanRev.data?.length ?? 0}`);
  }

  let processed = 0;
  const errors: string[] = [];

  type ApiChar = { id: number; hashed_id: string; name: string };
  type TrackedMember = typeof activeMembers[number] & { character_id: number | null };

  // charInfoMap: hashed_id → {id, name} — built from API responses across all members
  const charInfoMap = new Map<string, { id: number; name: string; hashed_id: string }>();
  // altGraph: bidirectional graph, hashed_id → set of related hashed_ids on same account
  const altGraph = new Map<string, Set<string>>();

  // Phase 1: fetch API data, build charInfoMap + altGraph
  for (const member of activeMembers) {
    if (!member.hashed_id) continue;
    try {
      const chars = await api.getCharacterAlts(member.hashed_id);
      processed++;

      const charNames = chars.map((c: ApiChar) => `${c.name}(${c.id})`).join(', ');
      debugLog.push(`P1 ${member.ign}: API returned [${charNames}]`);

      // Record all returned chars (these are alts of member, not self)
      for (const char of chars) {
        charInfoMap.set(char.hashed_id, { id: char.id, name: char.name, hashed_id: char.hashed_id });
        // If this alt is a tracked member and lacks character_id, populate it now
        const charMember = hashedIdToMember.get(char.hashed_id);
        if (charMember && charMember.character_id == null) {
          await supabase.from('members').update({ character_id: char.id }).eq('id', charMember.id);
          (charMember as TrackedMember).character_id = char.id;
          debugLog.push(`  Populated character_id=${char.id} for ${charMember.ign}`);
        }
      }

      // Seed self in charInfoMap if character_id is known
      if ((member as TrackedMember).character_id != null && !charInfoMap.has(member.hashed_id)) {
        charInfoMap.set(member.hashed_id, { id: (member as TrackedMember).character_id!, name: member.ign, hashed_id: member.hashed_id });
      }

      // Build bidirectional graph edges: member ↔ each char
      if (!altGraph.has(member.hashed_id)) altGraph.set(member.hashed_id, new Set());
      for (const char of chars) {
        altGraph.get(member.hashed_id)!.add(char.hashed_id);
        if (!altGraph.has(char.hashed_id)) altGraph.set(char.hashed_id, new Set());
        altGraph.get(char.hashed_id)!.add(member.hashed_id);
      }

      await new Promise((r) => setTimeout(r, 200));
    } catch (err) {
      errors.push(`${member.ign}: ${String(err)}`);
      debugLog.push(`P1 ERROR ${member.ign}: ${String(err)}`);
    }
  }

  debugLog.push(`=== PHASE 1 DONE: ${altGraph.size} nodes in alt graph ===`);

  // Phase 2: union-find to get connected components (all chars on same account)
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
  for (const hashedId of Array.from(altGraph.keys())) {
    const root = find(hashedId);
    if (!components.has(root)) components.set(root, new Set());
    components.get(root)!.add(hashedId);
  }

  debugLog.push(`=== PHASE 2: ${components.size} account components ===`);

  let totalAltLinks = 0;

  for (const componentHashedIds of Array.from(components.values())) {
    const allHashedIds = Array.from(componentHashedIds);

    // All tracked members (globally) in this component
    type AllMember = NonNullable<ReturnType<typeof hashedIdToMember.get>>;
    const allTracked: AllMember[] = allHashedIds
      .map((h) => hashedIdToMember.get(h))
      .filter((m): m is AllMember => !!m);

    if (allTracked.length === 0) continue;

    // Representative = tracked member with lowest numeric character ID
    let representative: AllMember | undefined;
    let lowestId = Infinity;
    for (const member of allTracked) {
      const info = charInfoMap.get(member.hashed_id);
      const numId = info?.id ?? (member as TrackedMember).character_id ?? Infinity;
      if (numId < lowestId) {
        lowestId = numId;
        representative = member;
      }
    }
    if (!representative) representative = allTracked[0];

    const allTrackedIds = allTracked.map((m) => m.id);

    debugLog.push(
      `P2 component [${allHashedIds.length} chars]: tracked=[${allTracked.map((m) => m.ign).join(', ')}] rep=${representative.ign}(charId=${lowestId === Infinity ? '?' : lowestId})`
    );

    // Delete all existing alt links for all tracked members in this component
    const [delFwd, delRev] = await Promise.all([
      supabase.from('member_alts').delete().in('member_id', allTrackedIds).select('id'),
      supabase.from('member_alts').delete().in('alt_member_id', allTrackedIds).select('id'),
    ]);
    debugLog.push(`  DELETE fwd=${delFwd.data?.length ?? 0} rev=${delRev.data?.length ?? 0}`
      + (delFwd.error ? ` FWD_ERR:${delFwd.error.message}` : '')
      + (delRev.error ? ` REV_ERR:${delRev.error.message}` : ''));

    // Insert: representative → every other char on the account
    const otherHashedIds = allHashedIds.filter((h) => h !== representative!.hashed_id);
    totalAltLinks += otherHashedIds.length;

    for (const hashedId of otherHashedIds) {
      const info = charInfoMap.get(hashedId);
      if (!info) {
        debugLog.push(`  SKIP ${hashedId.slice(0, 8)}… — no charInfo`);
        continue;
      }
      const altMember = hashedIdToMember.get(hashedId);
      const { error: insErr } = await supabase.from('member_alts').insert({
        member_id: representative.id,
        alt_ign: info.name,
        alt_hashed_id: info.hashed_id,
        alt_character_id: info.id,
        alt_member_id: altMember?.id ?? null,
        fetched_at: new Date().toISOString(),
      });
      debugLog.push(
        `  INSERT ${representative.ign} → ${info.name}(tracked=${altMember?.ign ?? 'no'})`
        + (insErr ? ` ERR:${insErr.message}` : ' OK')
      );
    }
  }

  // Phase 3: propagate discord info within each account component
  for (const componentHashedIds of Array.from(components.values())) {
    const allHashedIds = Array.from(componentHashedIds);
    type AllMember2 = NonNullable<ReturnType<typeof hashedIdToMember.get>>;
    const allTracked2: AllMember2[] = allHashedIds
      .map((h) => hashedIdToMember.get(h))
      .filter((m): m is AllMember2 => !!m);
    if (allTracked2.length <= 1) continue;
    const discordSource = allTracked2.find((m) => (m as typeof allTracked2[0]).discord_id != null);
    if (!discordSource) continue;
    const ds = discordSource as typeof allTracked2[0];
    for (const member of allTracked2) {
      const m = member as typeof allTracked2[0];
      if (m.id === ds.id || m.discord_id != null) continue;
      await supabase.from('members').update({
        discord_id: ds.discord_id,
        discord_username: ds.discord_username ?? null,
      }).eq('id', m.id);
      debugLog.push(`P3 discord propagate: ${ds.discord_username ?? ds.discord_id} → ${m.ign}`);
    }
  }

  // Verify: read back member_alts and check for duplicates
  const { data: finalRows } = await supabase
    .from('member_alts')
    .select('member_id, alt_hashed_id, alt_ign');

  const seen = new Map<string, number>();
  const dupeKeys: string[] = [];
  for (const row of finalRows ?? []) {
    const k = `${row.member_id}::${row.alt_hashed_id}`;
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  for (const [k, count] of Array.from(seen.entries())) {
    if (count > 1) dupeKeys.push(`${k} ×${count}`);
  }

  debugLog.push(`=== FINAL: ${finalRows?.length ?? 0} rows in member_alts, ${dupeKeys.length} duplicate pairs ===`);

  const rawTable = (finalRows ?? []).map((r) => `member_id=${r.member_id} alt=${r.alt_ign}(${r.alt_hashed_id?.slice(0, 8)}…)`);

  return NextResponse.json({
    total_members_with_hashed_id: activeMembers.length,
    processed,
    components: components.size,
    alt_links_written: totalAltLinks,
    error_count: errors.length,
    errors: errors.slice(0, 20),
    duplicates: dupeKeys,
    debug: debugLog,
    raw_member_alts: rawTable,
  });
}
