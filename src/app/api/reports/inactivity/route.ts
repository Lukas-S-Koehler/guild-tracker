import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { verifyAuth, isErrorResponse } from '@/lib/auth-helpers';

export async function GET(req: NextRequest) {
  // Verify authentication (members can view reports)
  const auth = await verifyAuth(req, 'MEMBER');
  if (isErrorResponse(auth)) return auth;

  const { guildId } = auth;
  const supabase = createServerClient(req);

  // Query members in the current guild with their latest activity
  const { data: members, error: membersError } = await supabase
    .from('members')
    .select('id, ign, last_seen, first_seen, is_active')
    .eq('current_guild_id', guildId)
    .eq('is_active', true);

  if (membersError) {
    console.error('[Inactivity Report] Error fetching members:', membersError);
    return NextResponse.json({ error: membersError.message }, { status: 500 });
  }

  if (!members || members.length === 0) {
    return NextResponse.json([]);
  }

  // Get the most recent activity date for each member in this guild
  const { data: recentLogs, error: logsError } = await supabase
    .from('daily_logs')
    .select('member_id, log_date')
    .eq('guild_id', guildId)
    .in('member_id', members.map(m => m.id))
    .order('log_date', { ascending: false });

  if (logsError) {
    console.error('[Inactivity Report] Error fetching logs:', logsError);
    return NextResponse.json({ error: logsError.message }, { status: 500 });
  }

  // Build a map of member_id -> most recent log_date
  const lastActivityMap = new Map<string, string>();
  recentLogs?.forEach(log => {
    if (!lastActivityMap.has(log.member_id)) {
      lastActivityMap.set(log.member_id, log.log_date);
    }
  });

  // Calculate inactivity for each member
  const today = new Date();
  const inactiveMembers = members
    .map(member => {
      const lastActivityDate = lastActivityMap.get(member.id) || member.last_seen;

      if (!lastActivityDate) {
        // Never had any activity
        return {
          id: member.id,
          ign: member.ign,
          last_active_date: null,
          days_inactive: 999,
          category: 'never' as const,
        };
      }

      const lastDate = new Date(lastActivityDate);
      const daysDiff = Math.floor((today.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));

      // Determine category
      let category: string;
      if (daysDiff === 0) {
        category = 'active';
      } else if (daysDiff >= 7) {
        category = '1w+';
      } else if (daysDiff >= 4) {
        category = `${daysDiff}d`;
      } else {
        category = 'recent'; // Less than 4 days
      }

      return {
        id: member.id,
        ign: member.ign,
        last_active_date: lastActivityDate,
        days_inactive: daysDiff,
        category,
      };
    })
    .filter(m => {
      // Filter out invalid entries
      if (!m.ign || m.ign.toLowerCase().includes('raw activity') || m.ign.toLowerCase().includes('log')) {
        return false;
      }
      // Only show inactive members (not active today and not recent)
      return m.category !== 'active' && m.category !== 'recent';
    })
    .sort((a, b) => {
      // Sort by severity (never first, then by days)
      if (a.category === 'never') return -1;
      if (b.category === 'never') return 1;
      return b.days_inactive - a.days_inactive;
    });

  return NextResponse.json(inactiveMembers);
}
