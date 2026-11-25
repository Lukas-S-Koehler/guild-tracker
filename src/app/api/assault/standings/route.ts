import { requireAccess } from '@/lib/access-server';
import { isResponse } from '@/lib/user-auth';
import { NextRequest, NextResponse } from 'next/server';
import {
  getCurrentSeason,
  getSeasonOverview,
  getBestFinishes,
  getTopAssaulters,
  getTrackedGuilds,
  getDreamExternalIds,
} from '@/lib/assault-standings-service';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const gate = await requireAccess(req, 'member');
  if (isResponse(gate)) return gate;
  try {
    const { searchParams } = new URL(req.url);
    const current = await getCurrentSeason();
    const season = parseInt(searchParams.get('season') ?? '', 10) || current;
    const tracked = await getTrackedGuilds();
    const ids = tracked.map(t => t.external_id);
    const [overview, best, members] = await Promise.all([
      getSeasonOverview(season, tracked),
      getBestFinishes(ids),
      getTopAssaulters(await getDreamExternalIds(), { season, limit: 50 }),
    ]);
    return NextResponse.json({ current_season: current, ...overview, best_finishes: best, members });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
