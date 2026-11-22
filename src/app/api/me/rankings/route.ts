import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { requireUser, isResponse } from '@/lib/user-auth';
import { buildMeRankings } from '@/lib/me-rankings';

export const dynamic = 'force-dynamic';

/**
 * GET /api/me/rankings
 * The signed-in user's leaderboard ranks, whole account as one entry: activity
 * (week / month / all time / own guild this week) and assault XP (season / all time).
 * Separate from /api/me/summary because the assault leaderboard is slow to build.
 */
export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  try {
    return NextResponse.json(await buildMeRankings(user.id, createAdminClient()));
  } catch (e) {
    console.error('[me/rankings]', e);
    return NextResponse.json({ error: 'Failed to build rankings' }, { status: 500 });
  }
}
