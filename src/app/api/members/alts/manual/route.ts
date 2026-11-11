import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { verifyAuth, isErrorResponse } from '@/lib/auth-helpers';

export const dynamic = 'force-dynamic';

// POST /api/members/alts/manual
// body: { main_member_id, alt_member_id }
// Creates a leader-set permanent alt link between two tracked members.
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req, 'LEADER');
  if (isErrorResponse(auth)) return auth;

  const body = await req.json().catch(() => null);
  const mainMemberId: string | undefined = body?.main_member_id;
  const altMemberId: string | undefined = body?.alt_member_id;

  if (!mainMemberId || !altMemberId) {
    return NextResponse.json({ error: 'main_member_id and alt_member_id required' }, { status: 400 });
  }
  if (mainMemberId === altMemberId) {
    return NextResponse.json({ error: 'A member cannot be an alt of itself' }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data: members, error } = await supabase
    .from('members')
    .select('id, ign, hashed_id, character_id')
    .in('id', [mainMemberId, altMemberId]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const main = members?.find((m) => m.id === mainMemberId);
  const alt = members?.find((m) => m.id === altMemberId);
  if (!main || !alt) return NextResponse.json({ error: 'Member(s) not found' }, { status: 404 });
  if (!main.hashed_id || !alt.hashed_id) {
    return NextResponse.json({ error: 'Both members need a hashed_id. Run Backfill Hashed IDs first.' }, { status: 400 });
  }

  // Remove any conflicting sync row for the same pair in either direction
  await Promise.all([
    supabase.from('member_alts').delete().eq('source', 'sync')
      .eq('member_id', main.id).eq('alt_hashed_id', alt.hashed_id),
    supabase.from('member_alts').delete().eq('source', 'sync')
      .eq('member_id', alt.id).eq('alt_hashed_id', main.hashed_id),
  ]);

  const { data: inserted, error: insertError } = await supabase
    .from('member_alts')
    .upsert({
      member_id: main.id,
      alt_ign: alt.ign,
      alt_hashed_id: alt.hashed_id,
      alt_character_id: alt.character_id ?? null,
      alt_member_id: alt.id,
      fetched_at: new Date().toISOString(),
      source: 'manual',
    }, { onConflict: 'member_id,alt_hashed_id' })
    .select()
    .single();

  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });
  return NextResponse.json({ ok: true, link: inserted });
}

// DELETE /api/members/alts/manual?id=<row_id>
export async function DELETE(req: NextRequest) {
  const auth = await verifyAuth(req, 'LEADER');
  if (isErrorResponse(auth)) return auth;

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const supabase = createAdminClient();
  const { data: row } = await supabase.from('member_alts').select('id, source').eq('id', id).single();
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (row.source !== 'manual') {
    return NextResponse.json({ error: 'Can only delete manual links. Sync-derived links are rewritten by sync.' }, { status: 400 });
  }
  const { error } = await supabase.from('member_alts').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
