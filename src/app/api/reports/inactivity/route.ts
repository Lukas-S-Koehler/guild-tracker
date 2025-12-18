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
    .select('id, ign, position, avatar_url, last_seen, first_seen, is_active')
    .eq('current_guild_id', guildId)
    .eq('is_active', true);

  if (membersError) {
    console.error('[Inactivity Report] Error fetching members:', membersError);
    return NextResponse.json({ error: membersError.message }, { status: 500 });
  }

  if (!members || members.length === 0) {
    return NextResponse.json([]);
  }

  // Get the most recent activity date where member MET REQUIREMENTS for each member in this guild
  const { data: recentLogs, error: logsError } = await supabase
    .from('daily_logs')
    .select('member_id, log_date')
    .eq('guild_id', guildId)
    .eq('met_requirement', true) // ONLY count days where requirement was met
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
          position: member.position,
          avatar_url: member.avatar_url,
          last_active_date: null,
          days_inactive: 999,
          category: 'never' as const,
          warning_level: 'kick' as const, // Immediate kick for never active
        };
      }

      const lastDate = new Date(lastActivityDate);
      const daysDiff = Math.floor((today.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));

      // Determine category and warning level based on days since last met requirement
      let category: string;
      let warning_level: 'safe' | 'warn1' | 'warn2' | 'kick';

      if (daysDiff === 0) {
        category = 'active';
        warning_level = 'safe';
      } else if (daysDiff === 1) {
        category = '1d';
        warning_level = 'safe';
      } else if (daysDiff >= 2 && daysDiff <= 3) {
        category = `${daysDiff}d`;
        warning_level = 'warn1'; // 2-3 days: private warning
      } else if (daysDiff >= 4 && daysDiff <= 6) {
        category = `${daysDiff}d`;
        warning_level = 'warn2'; // 4-6 days: public warning
      } else if (daysDiff >= 7) {
        category = '7d+';
        warning_level = 'kick'; // 7+ days: kick
      } else {
        category = 'active';
        warning_level = 'safe';
      }

      return {
        id: member.id,
        ign: member.ign,
        position: member.position,
        avatar_url: member.avatar_url,
        last_active_date: lastActivityDate,
        days_inactive: daysDiff,
        category,
        warning_level,
      };
    })
    .filter(m => {
      // Filter out invalid entries
      if (!m.ign || m.ign.toLowerCase().includes('raw activity') || m.ign.toLowerCase().includes('log')) {
        return false;
      }
      // Filter out LEADER and DEPUTY positions - they are not tracked for inactivity
      if (m.position === 'LEADER' || m.position === 'DEPUTY') {
        return false;
      }
      // Only show inactive members (not active today)
      return m.category !== 'active';
    })
    .sort((a, b) => {
      // Sort by severity (never first, then by days)
      if (a.category === 'never') return -1;
      if (b.category === 'never') return 1;
      return b.days_inactive - a.days_inactive;
    });

  return NextResponse.json(inactiveMembers);
}
