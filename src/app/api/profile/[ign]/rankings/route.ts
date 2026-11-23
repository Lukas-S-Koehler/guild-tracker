import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { requireMember, isResponse } from '@/lib/user-auth';
import { findProfileAccount, safeDecode } from '@/lib/profile';
import { buildRankingsFor } from '@/lib/me-rankings';

export const dynamic = 'force-dynamic';

/** GET /api/profile/[ign]/rankings — that account's leaderboard ranks (slow, loaded separately). */
export async function GET(req: NextRequest, { params }: { params: { ign: string } }) {
  const user = await requireMember(req);
  if (isResponse(user)) return user;
  const supabase = createAdminClient();
  try {
    const account = await findProfileAccount(safeDecode(params.ign), supabase);
    if (!account) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(await buildRankingsFor(account.characters, supabase));
  } catch (e) {
    console.error('[profile/rankings]', e);
    return NextResponse.json({ error: 'Failed to build rankings' }, { status: 500 });
  }
}
