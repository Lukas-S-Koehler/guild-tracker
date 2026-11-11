import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { verifySuperAdmin, isErrorResponse } from '@/lib/auth-helpers';
import { IdleMMOApi } from '@/lib/idlemmo-api';
import { runAltSync } from '@/lib/alt-sync';

export const dynamic = 'force-dynamic';

const SUPER_ADMIN_USER_ID = '5f33bb41-86ab-4024-a1da-6a2fea5fb36b';

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
    .select('id, hashed_id, current_guild_id')
    .eq('is_active', true)
    .not('hashed_id', 'is', null);
  if (allMembersError) return NextResponse.json({ error: allMembersError.message }, { status: 500 });

  const seedHashedIds = (allMembers ?? [])
    .filter((m) => m.current_guild_id != null && m.hashed_id)
    .map((m) => m.hashed_id!) as string[];

  // Orphan cleanup: delete any row referencing a non-active member id
  const activeIds = (allMembers ?? []).map((m) => m.id);
  if (activeIds.length > 0) {
    await Promise.all([
      supabase.from('member_alts').delete().not('member_id', 'in', `(${activeIds.join(',')})`),
      supabase.from('member_alts').delete().not('alt_member_id', 'is', null).not('alt_member_id', 'in', `(${activeIds.join(',')})`),
    ]);
  }

  const result = await runAltSync({ supabase, api, seedHashedIds });

  const { data: finalRows } = await supabase
    .from('member_alts')
    .select('member_id, alt_hashed_id');
  const seen = new Map<string, number>();
  const dupeKeys: string[] = [];
  for (const row of finalRows ?? []) {
    const k = `${row.member_id}::${row.alt_hashed_id}`;
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  for (const [k, count] of Array.from(seen.entries())) {
    if (count > 1) dupeKeys.push(`${k} ×${count}`);
  }

  return NextResponse.json({
    total_members_with_hashed_id: seedHashedIds.length,
    processed: result.processed,
    components: result.components,
    alts_found: result.alt_links_written,
    alt_links_written: result.alt_links_written,
    manual_preserved: result.manual_preserved,
    error_count: result.errors.length,
    errors: result.errors.slice(0, 20),
    duplicates: dupeKeys,
  });
}
