import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { verifyAuth, isErrorResponse } from '@/lib/auth-helpers';

/**
 * GET /api/members/activity-history?member_id=xxx
 * Returns last 7 days of activity for a member with gold donated and % of challenge
 */
export async function GET(req: NextRequest) {
  // Verify authentication (members can view)
  const auth = await verifyAuth(req, 'MEMBER');
  if (isErrorResponse(auth)) return auth;

  const { guildId } = auth;
  const supabase = createServerClient(req);
  const { searchParams } = new URL(req.url);
  const memberId = searchParams.get('member_id');

  if (!memberId) {
    return NextResponse.json({ error: 'member_id is required' }, { status: 400 });
  }

  // Get last 7 days of daily logs for this member in this guild
  const { data: logs, error: logsError } = await supabase
    .from('daily_logs')
    .select('id, log_date, gold_donated, deposits_gold, raids, met_requirement')
    .eq('member_id', memberId)
    .eq('guild_id', guildId)
    .order('log_date', { ascending: false })
    .limit(7);

  if (logsError) {
    console.error('[Activity History] Error fetching logs:', logsError);
    return NextResponse.json({ error: logsError.message }, { status: 500 });
  }

  if (!logs || logs.length === 0) {
    return NextResponse.json([]);
  }

  // Get all unique dates from the logs
  const dates = logs.map(log => log.log_date);

  // Get challenges for these dates AND the day before each (since challenges can overlap)
  const allDates = new Set<string>();
  dates.forEach(date => {
    allDates.add(date);
    const prevDate = new Date(date);
    prevDate.setDate(prevDate.getDate() - 1);
    allDates.add(prevDate.toISOString().split('T')[0]);
  });

  const { data: challenges } = await supabase
    .from('challenges')
    .select('challenge_date, total_cost')
    .eq('guild_id', guildId)
    .in('challenge_date', Array.from(allDates))
    .order('challenge_date', { ascending: false });

  // Build a map of date -> challenge total
  const challengeMap = new Map<string, number>();
  challenges?.forEach(c => {
    challengeMap.set(c.challenge_date, c.total_cost);
  });

  // Build response with challenge percentages
  const activity = logs.map(log => {
    // Check challenge for this date and previous day (same logic as activity route)
    const logDate = log.log_date;
    const prevDate = new Date(logDate);
    prevDate.setDate(prevDate.getDate() - 1);
    const prevDateStr = prevDate.toISOString().split('T')[0];

    // Use the most recent challenge (current day first, then previous)
    const challengeTotal = challengeMap.get(logDate) || challengeMap.get(prevDateStr) || 0;
    const challengePercent = challengeTotal > 0
      ? Math.round((log.gold_donated / challengeTotal) * 100)
      : 0;

    const totalGold = (log.gold_donated || 0) + (log.deposits_gold || 0);

    return {
      date: log.log_date,
      gold_donated: log.gold_donated,
      deposits_gold: log.deposits_gold || 0,
      total_gold: totalGold,
      raids: log.raids,
      met_requirement: log.met_requirement,
      challenge_total: challengeTotal,
      challenge_percent: challengePercent,
    };
  });

  return NextResponse.json(activity);
}
