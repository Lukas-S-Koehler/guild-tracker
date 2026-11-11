import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { verifyAuth, isErrorResponse } from '@/lib/auth-helpers';
import { switchAccountMain } from '@/lib/alt-switch';

export const dynamic = 'force-dynamic';

// POST /api/members/alts/set-main { member_id }
// Promotes the given member to be the main (representative) of its alt account.
// All resulting rows are source='manual' so future syncs won't override.
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req, 'LEADER');
  if (isErrorResponse(auth)) return auth;

  const body = await req.json().catch(() => null);
  const memberId: string | undefined = body?.member_id;
  if (!memberId) return NextResponse.json({ error: 'member_id required' }, { status: 400 });

  const supabase = createAdminClient();
  const { data: member } = await supabase
    .from('members')
    .select('id, ign, hashed_id')
    .eq('id', memberId)
    .single();
  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 });
  if (!member.hashed_id) return NextResponse.json({ error: 'Member missing hashed_id' }, { status: 400 });

  const result = await switchAccountMain(supabase, memberId);
  return NextResponse.json({ ok: true, ...result });
}
