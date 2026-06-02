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

  // Get API key for this guild
  const { data: config } = await supabase
    .from('guild_config')
    .select('api_key')
    .eq('guild_id', guildId)
    .single();

  if (!config?.api_key) {
    return NextResponse.json({ error: 'No API key configured for this guild' }, { status: 400 });
  }

  const api = new IdleMMOApi(config.api_key);

  // Fetch all active members with a hashed_id
  const { data: members } = await supabase
    .from('members')
    .select('id, ign, hashed_id')
    .eq('current_guild_id', guildId)
    .eq('is_active', true)
    .not('hashed_id', 'is', null);

  if (!members || members.length === 0) {
    return NextResponse.json({
      processed: 0,
      alts_found: 0,
      message: 'No members with hashed_id found. Run backfill-hashed-ids first.',
    });
  }

  // Fetch all tracked members' hashed_ids for cross-referencing
  const { data: allMembers } = await supabase
    .from('members')
    .select('id, ign, hashed_id, current_guild_id')
    .eq('is_active', true)
    .not('hashed_id', 'is', null);

  const hashedIdToMember = new Map(
    (allMembers ?? []).map((m) => [m.hashed_id, m])
  );

  let processed = 0;
  let altsFound = 0;
  const errors: string[] = [];

  for (const member of members) {
    if (!member.hashed_id) continue;

    try {
      const alts = await api.getCharacterAlts(member.hashed_id);
      processed++;

      // Filter out the member themselves
      const otherAlts = alts.filter((a) => a.hashed_id !== member.hashed_id);
      altsFound += otherAlts.length;

      for (const alt of otherAlts) {
        const altMember = hashedIdToMember.get(alt.hashed_id);

        await supabase.from('member_alts').upsert(
          {
            member_id: member.id,
            alt_ign: alt.name,
            alt_hashed_id: alt.hashed_id,
            alt_member_id: altMember?.id ?? null,
            fetched_at: new Date().toISOString(),
          },
          { onConflict: 'member_id,alt_hashed_id' }
        );
      }

      // Brief rate-limit pause
      await new Promise((r) => setTimeout(r, 200));
    } catch (err) {
      errors.push(`${member.ign}: ${String(err)}`);
    }
  }

  return NextResponse.json({ processed, alts_found: altsFound, errors });
}
