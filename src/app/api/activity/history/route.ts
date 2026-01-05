import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { verifyAuth, isErrorResponse } from '@/lib/auth-helpers';

/**
 * GET /api/activity/history
 * Returns activity logs grouped by date for the current guild
 */
export async function GET(req: NextRequest) {
  // Verify authentication (members can view)
  const auth = await verifyAuth(req, 'MEMBER');
  if (isErrorResponse(auth)) return auth;

  const { guildId } = auth;
  const supabase = createServerClient(req);

  // Get all daily_logs for this guild, grouped by date
  const { data: logs, error } = await supabase
    .from('daily_logs')
    .select(`
      id,
      log_date,
      raids,
      gold_donated,
      deposits_gold,
      met_requirement,
      log_order,
      members!inner (
        id,
        ign
      )
    `)
    .eq('guild_id', guildId)
    .order('log_date', { ascending: false })
    .order('log_order', { ascending: true }); // Order by chronological order (0 = most recent)

  if (error) {
    console.error('[Activity History] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Group by date
  const grouped: Record<string, any[]> = {};
  logs?.forEach(log => {
    if (!grouped[log.log_date]) {
      grouped[log.log_date] = [];
    }
    grouped[log.log_date].push({
      id: log.id,
      ign: (log.members as any).ign,
      raids: log.raids,
      gold_donated: log.gold_donated,
      deposits_gold: log.deposits_gold || 0,
      met_requirement: log.met_requirement,
    });
  });

  // Convert to array of dates with their logs
  const result = Object.keys(grouped).map(date => ({
    date,
    member_count: grouped[date].length,
    total_raids: grouped[date].reduce((sum, l) => sum + l.raids, 0),
    total_gold: grouped[date].reduce((sum, l) => sum + l.gold_donated + (l.deposits_gold || 0), 0),
    logs: grouped[date],
  }));

  return NextResponse.json(result);
}
