import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { verifyAuth, isErrorResponse } from '@/lib/auth-helpers';
import { IdleMMOApi } from '@/lib/idlemmo-api';
import { runAltSync } from '@/lib/alt-sync';

export const dynamic = 'force-dynamic';

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

  const { data: fwdAlts } = await supabase
    .from('member_alts')
    .select('*, alt_member:alt_member_id(id, ign, current_guild_id, discord_id, discord_username)')
    .in('member_id', memberIds);

  const { data: revRaw } = await supabase
    .from('member_alts')
    .select('id, member_id, alt_ign, alt_hashed_id, alt_member_id, alt_character_id, fetched_at, source')
    .in('alt_member_id', memberIds);

  const fwdLinkIds = new Set((fwdAlts ?? []).map((a) => a.id));
  const uniqueRevLinks = (revRaw ?? []).filter((r) => !fwdLinkIds.has(r.id));

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

  const { data: guildMembers } = await supabase
    .from('members')
    .select('id, hashed_id')
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

  const api = new IdleMMOApi(config.api_key);
  const result = await runAltSync({
    supabase,
    api,
    seedHashedIds: guildMembers.map((m) => m.hashed_id!).filter(Boolean),
    scopeGuildId: guildId,
  });

  return NextResponse.json({
    processed: result.processed,
    components: result.components,
    alts_found: result.alt_links_written,
    alt_links_written: result.alt_links_written,
    manual_links_preserved: result.manual_preserved,
    errors: result.errors,
  });
}
