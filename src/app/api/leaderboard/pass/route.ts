import { NextRequest, NextResponse } from 'next/server';
import { requireMember, isResponse } from '@/lib/user-auth';
import { createAdminClient } from '@/lib/supabase-server';
import { passBoard } from '@/lib/network-boards';

export const dynamic = 'force-dynamic';

/** GET /api/leaderboard/pass?season=YYYY-MM — Dream Pass board of any month (members only). */
export async function GET(req: NextRequest) {
  const user = await requireMember(req);
  if (isResponse(user)) return user;
  const season = req.nextUrl.searchParams.get('season') ?? '';
  if (!/^\d{4}-\d{2}$/.test(season)) return NextResponse.json({ error: 'season=YYYY-MM required' }, { status: 400 });
  try {
    return NextResponse.json({ season, rows: await passBoard(createAdminClient(), season) });
  } catch (e) {
    console.error('[leaderboard/pass]', e);
    return NextResponse.json({ error: 'Failed to build the board' }, { status: 500 });
  }
}
