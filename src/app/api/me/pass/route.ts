import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { requireUser, isResponse } from '@/lib/user-auth';
import { getAccountCharacters } from '@/lib/account-service';
import { accountPass } from '@/lib/dream-pass-account';

export const dynamic = 'force-dynamic';

const seasonParam = (req: NextRequest) => {
  const s = req.nextUrl.searchParams.get('season') ?? '';
  return /^\d{4}-\d{2}$/.test(s) ? s : undefined;
};

/** GET /api/me/pass — the signed-in user's Dream Pass (season + lifetime + Discord level). */
export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  const supabase = createAdminClient();
  try {
    const chars = await getAccountCharacters(user.id, supabase);
    if (!chars.length) return NextResponse.json({ claimed: false });
    return NextResponse.json({ claimed: true, ...(await accountPass(supabase, chars.map((c) => c.member_id), seasonParam(req))) });
  } catch (e) {
    console.error('[me/pass]', e);
    return NextResponse.json({ error: 'Failed to load the Dream Pass' }, { status: 500 });
  }
}
