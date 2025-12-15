import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase';
import { getToday, getInactivityCategory } from '@/lib/utils';

export async function GET() {
  const supabase = createClient();

  // Get all members
  const { data: members, error: membersError } = await supabase
    .from('members')
    .select('id, ign');

  if (membersError) {
    return NextResponse.json({ error: membersError.message }, { status: 500 });
  }

  // Get all logs where requirement was met
  const { data: logs, error: logsError } = await supabase
    .from('daily_logs')
    .select('member_id, log_date')
    .eq('met_requirement', true)
    .order('log_date', { ascending: false });

  if (logsError) {
    return NextResponse.json({ error: logsError.message }, { status: 500 });
  }

  // Find last active date for each member
  const lastActiveMap = new Map<string, string>();
  logs?.forEach((log) => {
    if (!lastActiveMap.has(log.member_id)) {
      lastActiveMap.set(log.member_id, log.log_date);
    }
  });

  const today = new Date(getToday());

  // Calculate inactivity
  const report = members
    ?.map((member) => {
      const lastActiveDate = lastActiveMap.get(member.id);

      let daysInactive: number;

      if (!lastActiveDate) {
        daysInactive = -1; // Never active
      } else {
        const lastActive = new Date(lastActiveDate);
        daysInactive = Math.floor(
          (today.getTime() - lastActive.getTime()) / (1000 * 60 * 60 * 24)
        );
      }

      const category = getInactivityCategory(daysInactive);

      return {
        id: member.id,
        ign: member.ign,
        last_active_date: lastActiveDate || null,
        days_inactive: daysInactive,
        category,
      };
    })
    .filter((m) => m.category !== 'active')
    .sort((a, b) => {
      // Sort by severity (never first, then by days)
      if (a.category === 'never') return -1;
      if (b.category === 'never') return 1;
      return b.days_inactive - a.days_inactive;
    });

  return NextResponse.json(report || []);
}
