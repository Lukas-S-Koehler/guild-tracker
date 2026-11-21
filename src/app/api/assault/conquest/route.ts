import { NextRequest, NextResponse } from 'next/server';
import { getCurrentSeason, getSeasonZones, getTrackedExternalIds, listStandingSeasons } from '@/lib/assault-standings-service';

export const dynamic = 'force-dynamic';

// GET ?season=13 -> full guild ranking for every conquest location
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const current = await getCurrentSeason();
    const season = parseInt(searchParams.get('season') ?? '', 10) || current;
    const [ids, seasons] = await Promise.all([getTrackedExternalIds(), listStandingSeasons()]);
    const zones = await getSeasonZones(season, ids);
    return NextResponse.json({ current_season: current, season, seasons: Array.from(new Set([current, ...seasons])).sort((a, b) => b - a), zones });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
