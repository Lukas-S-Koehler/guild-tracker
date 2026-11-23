import { NextRequest, NextResponse } from 'next/server';
import { requireMember, isResponse } from '@/lib/user-auth';
import { getNetworkBoards } from '@/lib/network-boards';

export const dynamic = 'force-dynamic';

/** GET /api/leaderboard/network — streak, most improved and Dream XP boards (members only). */
export async function GET(req: NextRequest) {
  const user = await requireMember(req);
  if (isResponse(user)) return user;
  try {
    return NextResponse.json(await getNetworkBoards());
  } catch (e) {
    console.error('[leaderboard/network]', e);
    return NextResponse.json({ error: 'Failed to build network boards' }, { status: 500 });
  }
}
