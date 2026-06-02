import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';

// GET /api/leaderboard — public, no auth required
export async function GET(req: NextRequest) {
  const supabase = createAdminClient();
  const { searchParams } = new URL(req.url);

  const period = searchParams.get('period') || 'week';
  const guildFilter = searchParams.get('guild'); // Optional guild_id filter

  // Choose the appropriate view based on period
  let viewName: string;
  switch (period) {
    case 'week':
      viewName = 'v_weekly_leaderboard';
      break;
    case 'month':
      viewName = 'v_monthly_leaderboard';
      break;
    case 'all':
    default:
      viewName = 'v_global_leaderboard';
  }

  // Query the view
  let query = supabase.from(viewName).select('*');

  // Apply guild filter if provided
  if (guildFilter && guildFilter !== 'all') {
    query = query.eq('current_guild_id', guildFilter);
  }

  const { data: leaderboard, error } = await query;

  if (error) {
    console.error('[Leaderboard] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(leaderboard || []);
}
