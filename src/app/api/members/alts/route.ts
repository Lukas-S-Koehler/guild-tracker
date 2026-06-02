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

  const { data: alts } = await supabase
    .from('member_alts')
    .select('*, alt_member:alt_member_id(ign, current_guild_id)')
    .in('member_id', memberIds);

  return NextResponse.json(alts ?? []);
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
    .select('id, ign, hashed_id, current_guild_id')
    .eq('is_active', true)
    .not('hashed_id', 'is', null);

  const hashedIdToMember = new Map(
    (allMembers ?? []).map((m) => [m.hashed_id, m])
  );

  let processed = 0;
  const errors: string[] = [];

  type ApiChar = { id: number; hashed_id: string; name: string };
  type GuildMember = typeof guildMembers[number];
  const accountGroups = new Map<string, { chars: ApiChar[]; trackedMembers: GuildMember[] }>();

  // Phase 1: fetch API data, populate character_id, group by account
  for (const member of guildMembers) {
    if (!member.hashed_id) continue;
    try {
      const chars = await api.getCharacterAlts(member.hashed_id);
      processed++;

      const selfChar = chars.find((c) => c.hashed_id === member.hashed_id);
      if (selfChar && member.character_id !== selfChar.id) {
        await supabase.from('members').update({ character_id: selfChar.id }).eq('id', member.id);
        member.character_id = selfChar.id;
      }

      const minId = chars.reduce((m, c) => Math.min(m, c.id), Infinity);
      const key = String(minId);

      if (!accountGroups.has(key)) {
        accountGroups.set(key, { chars, trackedMembers: [] });
      }
      const group = accountGroups.get(key)!;
      if (chars.length > group.chars.length) group.chars = chars;
      group.trackedMembers.push(member);

      await new Promise((r) => setTimeout(r, 200));
    } catch (err) {
      errors.push(`${member.ign}: ${String(err)}`);
    }
  }

  // Phase 2: write clean, canonical alt links
  let totalAltLinks = 0;

  for (const { chars, trackedMembers } of Array.from(accountGroups.values())) {
    trackedMembers.sort((a: GuildMember, b: GuildMember) => (a.character_id ?? 999999) - (b.character_id ?? 999999));
    const representative = trackedMembers[0];

    const groupMemberIds = trackedMembers.map((m: GuildMember) => m.id);
    await supabase.from('member_alts').delete().in('member_id', groupMemberIds);

    const otherChars = chars.filter((c: ApiChar) => c.hashed_id !== representative.hashed_id);
    totalAltLinks += otherChars.length;

    for (const char of otherChars) {
      const altMember = hashedIdToMember.get(char.hashed_id);
      await supabase.from('member_alts').insert({
        member_id: representative.id,
        alt_ign: char.name,
        alt_hashed_id: char.hashed_id,
        alt_character_id: char.id,
        alt_member_id: altMember?.id ?? null,
        fetched_at: new Date().toISOString(),
      });
    }
  }

  return NextResponse.json({
    processed,
    accounts_grouped: accountGroups.size,
    alt_links_written: totalAltLinks,
    errors,
  });
}
