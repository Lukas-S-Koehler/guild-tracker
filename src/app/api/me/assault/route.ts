import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { requireUser, isResponse } from '@/lib/user-auth';
import { buildMeAssault } from '@/lib/me-assault';

export const dynamic = 'force-dynamic';

/**
 * GET /api/me/assault?season=N
 * The signed-in user's assault season (whole account): totals, per-zone ranks, waves + attendance,
 * next launch + checklist progress, pinned loadout. Past season = recap.
 */
export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  const season = parseInt(new URL(req.url).searchParams.get('season') ?? '', 10);
  try {
    return NextResponse.json(await buildMeAssault(user.id, createAdminClient(), { season: Number.isNaN(season) ? undefined : season }));
  } catch (e) {
    console.error('[me/assault]', e);
    return NextResponse.json({ error: 'Failed to build assault summary' }, { status: 500 });
  }
}
