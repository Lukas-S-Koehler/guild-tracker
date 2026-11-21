import { NextRequest, NextResponse } from 'next/server';
import {
  getCurrentSeason,
  getSeasonOverview,
  getBestFinishes,
  getTopAssaulters,
  getTrackedExternalIds,
} from '@/lib/assault-standings-service';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const current = await getCurrentSeason();
    const season = parseInt(searchParams.get('season') ?? '', 10) || current;
    const ids = await getTrackedExternalIds();
    const [overview, best, members] = await Promise.all([
      getSeasonOverview(season, ids),
      getBestFinishes(ids),
      getTopAssaulters(ids, { season, limit: 50 }),
    ]);
    return NextResponse.json({ current_season: current, ...overview, best_finishes: best, members });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
