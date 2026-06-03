import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { verifyAuth, isErrorResponse } from '@/lib/auth-helpers';
import { IdleMMOApi } from '@/lib/idlemmo-api';

// GET /api/members/alts — list alt relationships for a guild
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (isErrorResponse(auth)) return auth;

  const supabase = createAdminClient();
  const { guildId } = auth;

  const { data: members, error: membersError } = await supabase
    .from('members')
    .select('id, ign, hashed_id')
    .eq('current_guild_id', guildId)
    .eq('is_active', true);

  if (membersError) return NextResponse.json({ error: membersError.message }, { status: 500 });

  const memberIds = (members ?? []).map((m) => m.id);
  if (memberIds.length === 0) return NextResponse.json([]);

  // Forward: this guild's member is the main
  const { data: fwdAlts } = await supabase
    .from('member_alts')
    .select('*, alt_member:alt_member_id(id, ign, current_guild_id, discord_id, discord_username)')
    .in('member_id', memberIds);

  // Reverse: this guild's member is the alt
  // Fetch raw (no double-join — avoids FK ambiguity on same-table multi-ref)
  const { data: revRaw } = await supabase
    .from('member_alts')
    .select('id, member_id, alt_ign, alt_hashed_id, alt_member_id, alt_character_id, fetched_at')
    .in('alt_member_id', memberIds);

  // Deduplicate: links already in fwdAlts (same-guild mains) don't need reverse entry
  const fwdLinkIds = new Set((fwdAlts ?? []).map((a) => a.id));
  const uniqueRevLinks = (revRaw ?? []).filter((r) => !fwdLinkIds.has(r.id));

  // Fetch cross-guild main members' discord info in a single separate query
  const crossGuildMainIds = Array.from(new Set(uniqueRevLinks.map((r) => r.member_id)));
  let mainMemberRows: Array<{ id: string; ign: string; current_guild_id: string | null; discord_id: string | null; discord_username: string | null }> = [];
  if (crossGuildMainIds.length > 0) {
    const { data } = await supabase
      .from('members')
      .select('id, ign, current_guild_id, discord_id, discord_username')
      .in('id', crossGuildMainIds);
    mainMemberRows = data ?? [];
  }
  const mainDiscordMap = new Map(mainMemberRows.map((m) => [m.id, m]));

  const revAlts = uniqueRevLinks.map((r) => ({
    ...r,
    alt_member: null,
    main_member: mainDiscordMap.get(r.member_id) ?? null,
  }));

  return NextResponse.json([...(fwdAlts ?? []), ...revAlts]);
}

// POST /api/members/alts — fetch alt characters from IdleMMO API and store
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req, 'OFFICER');
  if (isErrorResponse(auth)) return auth;

  const supabase = createAdminClient();
  const { guildId } = auth;

  const { data: config } = await supabase
    .from('guild_config')
    .select('api_key')
    .eq('guild_id', guildId)
    .single();

  if (!config?.api_key) {
    return NextResponse.json({ error: 'No API key configured for this guild' }, { status: 400 });
  }

  const api = new IdleMMOApi(config.api_key);

  const { data: guildMembers } = await supabase
    .from('members')
    .select('id, ign, hashed_id, character_id')
    .eq('current_guild_id', guildId)
    .eq('is_active', true)
    .not('hashed_id', 'is', null);

  if (!guildMembers || guildMembers.length === 0) {
    return NextResponse.json({
      processed: 0,
      alts_found: 0,
      message: 'No members with hashed_id found. Run backfill-hashed-ids first.',
    });
  }

  // All tracked members globally for cross-referencing alt_member_id
  const { data: allMembers } = await supabase
    .from('members')
    .select('id, ign, hashed_id, character_id, current_guild_id, discord_id, discord_username')
    .eq('is_active', true)
    .not('hashed_id', 'is', null);

  const hashedIdToMember = new Map(
    (allMembers ?? []).map((m) => [m.hashed_id, m])
  );

  // Phase 0: orphan cleanup for guild members
  const guildMemberIds = guildMembers.map((m) => m.id);
  if (guildMemberIds.length > 0) {
    await Promise.all([
      supabase.from('member_alts').delete().in('member_id', guildMemberIds)
        .not('alt_member_id', 'in', `(${(allMembers ?? []).map(m => m.id).join(',')})`),
    ]);
  }

  let processed = 0;
  const errors: string[] = [];

  type ApiChar = { id: number; hashed_id: string; name: string };
  type GuildMember = typeof guildMembers[number];

  // charInfoMap: hashed_id → {id, name} — built from all API responses
  const charInfoMap = new Map<string, { id: number; name: string; hashed_id: string }>();
  // altGraph: bidirectional graph, hashed_id → set of related hashed_ids on same account
  const altGraph = new Map<string, Set<string>>();

  // Phase 1: fetch API data, build charInfoMap + altGraph
  for (const member of guildMembers) {
    if (!member.hashed_id) continue;
    try {
      const chars = await api.getCharacterAlts(member.hashed_id);
      processed++;

      // Record all returned chars
      for (const char of chars) {
        charInfoMap.set(char.hashed_id, { id: char.id, name: char.name, hashed_id: char.hashed_id });
        // If this alt is a tracked member lacking character_id, populate it
        const charMember = hashedIdToMember.get(char.hashed_id);
        if (charMember && charMember.character_id == null) {
          await supabase.from('members').update({ character_id: char.id }).eq('id', charMember.id);
          charMember.character_id = char.id;
        }
      }

      // Seed self in charInfoMap if character_id is known
      if (member.character_id != null && !charInfoMap.has(member.hashed_id)) {
        charInfoMap.set(member.hashed_id, { id: member.character_id, name: member.ign, hashed_id: member.hashed_id });
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
    }
  }

  // Phase 2: union-find connected components → write clean alt links
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

  let totalAltLinks = 0;

  for (const componentHashedIds of Array.from(components.values())) {
    const allHashedIds = Array.from(componentHashedIds);

    // All tracked members (globally) in this component
    type AllMember = NonNullable<ReturnType<typeof hashedIdToMember.get>>;
    const allTracked: AllMember[] = allHashedIds
      .map((h) => hashedIdToMember.get(h))
      .filter((m): m is AllMember => !!m);

    if (allTracked.length === 0) continue;

    // Only process components that have at least one guild member
    const hasGuildMember = allTracked.some((m) => m.current_guild_id === guildId);
    if (!hasGuildMember) continue;

    // Representative = tracked member with lowest numeric character ID
    let representative: AllMember | undefined;
    let lowestId = Infinity;
    for (const member of allTracked) {
      const info = charInfoMap.get(member.hashed_id);
      const numId = info?.id ?? (member as GuildMember).character_id ?? Infinity;
      if (numId < lowestId) {
        lowestId = numId;
        representative = member;
      }
    }
    if (!representative) representative = allTracked[0];

    // Delete all existing alt links for all tracked members in this component
    const allTrackedIds = allTracked.map((m) => m.id);
    await Promise.all([
      supabase.from('member_alts').delete().in('member_id', allTrackedIds),
      supabase.from('member_alts').delete().in('alt_member_id', allTrackedIds),
    ]);

    // Insert: representative → every other char on the account
    const otherHashedIds = allHashedIds.filter((h) => h !== representative!.hashed_id);
    totalAltLinks += otherHashedIds.length;

    for (const hashedId of otherHashedIds) {
      const info = charInfoMap.get(hashedId);
      if (!info) continue;
      const altMember = hashedIdToMember.get(hashedId);
      await supabase.from('member_alts').insert({
        member_id: representative.id,
        alt_ign: info.name,
        alt_hashed_id: info.hashed_id,
        alt_character_id: info.id,
        alt_member_id: altMember?.id ?? null,
        fetched_at: new Date().toISOString(),
      });
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
    }
  }

  return NextResponse.json({
    processed,
    components: components.size,
    alt_links_written: totalAltLinks,
    errors,
  });
}
