import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase';
import { getWeekStart, getMonthStart } from '@/lib/utils';

export async function GET(req: NextRequest) {
  const supabase = createClient();
  const { searchParams } = new URL(req.url);

  const period = searchParams.get('period') || 'week';

  let startDate: string;
  switch (period) {
    case 'week':
      startDate = getWeekStart();
      break;
    case 'month':
      startDate = getMonthStart();
      break;
    default:
      startDate = '2000-01-01';
  }

  // Get all members
  const { data: members, error: membersError } = await supabase
    .from('members')
    .select('id, ign');

  if (membersError) {
    return NextResponse.json({ error: membersError.message }, { status: 500 });
  }

  // Get logs for the period
  const { data: logs, error: logsError } = await supabase
    .from('daily_logs')
    .select('member_id, raids, gold_donated, met_requirement')
    .gte('log_date', startDate);

  if (logsError) {
    return NextResponse.json({ error: logsError.message }, { status: 500 });
  }

  // Aggregate by member
  const memberStats = new Map<string, {
    total_raids: number;
    total_gold: number;
    days_active: number;
  }>();

  logs?.forEach((log) => {
    const existing = memberStats.get(log.member_id) || {
      total_raids: 0,
      total_gold: 0,
      days_active: 0,
    };

    existing.total_raids += log.raids || 0;
    existing.total_gold += log.gold_donated || 0;
    if (log.met_requirement) {
      existing.days_active += 1;
    }

    memberStats.set(log.member_id, existing);
  });

  // Build leaderboard
  const leaderboard = members
    ?.map((member) => {
      const stats = memberStats.get(member.id) || {
        total_raids: 0,
        total_gold: 0,
        days_active: 0,
      };

      return {
        id: member.id,
        ign: member.ign,
        total_raids: stats.total_raids,
        total_gold: stats.total_gold,
        activity_score: (stats.total_raids * 1000) + stats.total_gold,
        days_active: stats.days_active,
      };
    })
    .filter((m) => m.activity_score > 0)
    .sort((a, b) => b.activity_score - a.activity_score);

  return NextResponse.json(leaderboard || []);
}
