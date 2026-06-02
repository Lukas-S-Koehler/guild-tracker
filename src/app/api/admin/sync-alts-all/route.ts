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

  // Get super admin's API key
  const { data: keyRow } = await supabase
    .from('user_api_keys')
    .select('api_key')
    .eq('user_id', SUPER_ADMIN_USER_ID)
    .single();

  if (!keyRow?.api_key) {
    return NextResponse.json({ error: 'No API key found for super admin. Add your IdleMMO API key in your profile settings.' }, { status: 400 });
  }

  const api = new IdleMMOApi(keyRow.api_key);

  // Fetch all tracked members with a hashed_id (across all guilds)
  const { data: allMembers, error: allMembersError } = await supabase
    .from('members')
    .select('id, ign, hashed_id, current_guild_id')
    .eq('is_active', true)
    .not('hashed_id', 'is', null);

  if (allMembersError) return NextResponse.json({ error: allMembersError.message }, { status: 500 });

  const hashedIdToMember = new Map(
    (allMembers ?? []).map((m) => [m.hashed_id, m])
  );

  // Get only active members (who are actually in a guild currently)
  const { data: activeMembers } = await supabase
    .from('members')
    .select('id, ign, hashed_id, current_guild_id')
    .eq('is_active', true)
    .not('hashed_id', 'is', null)
    .not('current_guild_id', 'is', null);

  let processed = 0;
  let altsFound = 0;
  const errors: string[] = [];

  for (const member of activeMembers ?? []) {
    if (!member.hashed_id) continue;
    try {
      const alts = await api.getCharacterAlts(member.hashed_id);
      processed++;

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

      await new Promise((r) => setTimeout(r, 200));
    } catch (err) {
      errors.push(`${member.ign}: ${String(err)}`);
    }
  }

  return NextResponse.json({
    total_members_with_hashed_id: activeMembers?.length ?? 0,
    processed,
    alts_found: altsFound,
    error_count: errors.length,
    errors: errors.slice(0, 20),
  });
}
