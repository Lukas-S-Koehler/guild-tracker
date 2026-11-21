import { NextRequest, NextResponse } from 'next/server';
import { getAssaultLeaderboard, getCurrentSeason, listStandingSeasons } from '@/lib/assault-standings-service';

export const dynamic = 'force-dynamic';

// GET ?season=13|all &guild=<external id> &merged=true|false
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const seasonParam = searchParams.get('season');
    const current = await getCurrentSeason();
    const season = seasonParam === 'all' ? undefined : parseInt(seasonParam ?? '', 10) || current;
    const guild = parseInt(searchParams.get('guild') ?? '', 10) || undefined;
    const merged = searchParams.get('merged') === 'true';
    const [{ rows, guilds }, seasons] = await Promise.all([
      getAssaultLeaderboard({ season, guildId: guild, merged }),
      listStandingSeasons(),
    ]);
    return NextResponse.json({
      current_season: current,
      seasons: Array.from(new Set([current, ...seasons])).sort((a, b) => b - a),
      guilds,
      entries: rows,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
