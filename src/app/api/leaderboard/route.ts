import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { fetchLeaderboard, type LeaderboardFilter, type LeaderboardPeriod } from '@/lib/leaderboard';

// GET /api/leaderboard — public, no auth required
export async function GET(req: NextRequest) {
  const supabase = createAdminClient();
  const { searchParams } = new URL(req.url);

  const period = (searchParams.get('period') || 'week') as LeaderboardPeriod;
  const guildFilter = searchParams.get('guild');
  const merged = searchParams.get('merged') !== 'false'; // default: merged=true
  const filterParam = (searchParams.get('filter') || 'all') as LeaderboardFilter;
  const filter: LeaderboardFilter =
    filterParam === 'locked' || filterParam === 'non-locked' ? filterParam : 'all';

  try {
    const entries = await fetchLeaderboard({
      supabase,
      period,
      guildFilter,
      merged,
      filter,
    });
    return NextResponse.json(entries);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
