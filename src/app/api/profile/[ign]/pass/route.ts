import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { requireMember, isResponse } from '@/lib/user-auth';
import { findProfileAccount, safeDecode } from '@/lib/profile';
import { accountPass } from '@/lib/dream-pass-account';

export const dynamic = 'force-dynamic';

const seasonParam = (req: NextRequest) => {
  const s = req.nextUrl.searchParams.get('season') ?? '';
  return /^\d{4}-\d{2}$/.test(s) ? s : undefined;
};

/** GET /api/profile/[ign]/pass — that account's Dream Pass (members only). */
export async function GET(req: NextRequest, { params }: { params: { ign: string } }) {
  const user = await requireMember(req);
  if (isResponse(user)) return user;
  const supabase = createAdminClient();
  try {
    const account = await findProfileAccount(safeDecode(params.ign), supabase);
    if (!account) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ claimed: true, ...(await accountPass(supabase, account.characters.map((c) => c.member_id), seasonParam(req))) });
  } catch (e) {
    console.error('[profile/pass]', e);
    return NextResponse.json({ error: 'Failed to load the Dream Pass' }, { status: 500 });
  }
}
