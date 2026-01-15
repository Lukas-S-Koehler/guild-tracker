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
  // Limit to recent logs to avoid fetching years of data (we only need the most recent per member)
  const { data: recentLogs, error: logsError } = await supabase
    .from('daily_logs')
    .select('member_id, log_date')
    .eq('guild_id', guildId)
    .eq('met_requirement', true) // ONLY count days where requirement was met
    .in('member_id', members.map(m => m.id))
    .order('log_date', { ascending: false })
    .limit(365); // Fetch last ~365 days of data (more than enough to find each member's recent activity)

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

  // Helper function to calculate warning level and category based on days inactive
  // New warning tiers: 1d=green, 2d=yellow(private), 3d=orange(private+optional public), 4d+=red(kick)
  const getWarningInfo = (daysInactive: number): { category: string; warning_level: 'safe' | 'warn1' | 'warn2' | 'kick' } => {
    if (daysInactive === 0) {
      return { category: 'active', warning_level: 'safe' };
    } else if (daysInactive === 1) {
      return { category: '1d', warning_level: 'safe' }; // Green - safe
    } else if (daysInactive === 2) {
      return { category: '2d', warning_level: 'warn1' }; // Yellow - private warn
    } else if (daysInactive === 3) {
      return { category: '3d', warning_level: 'warn2' }; // Orange - private + optional public
    } else {
      return { category: '4d+', warning_level: 'kick' }; // Red - kick
    }
  };

  // Calculate inactivity for each member
  const today = new Date();
  const inactiveMembers = members
    .map(member => {
      const lastActivityDate = lastActivityMap.get(member.id);

      // Calculate days since join (first_seen) - used to cap inactivity
      let daysSinceJoin = 999; // Default high value if no first_seen
      if (member.first_seen) {
        const joinDate = new Date(member.first_seen);
        daysSinceJoin = Math.floor((today.getTime() - joinDate.getTime()) / (1000 * 60 * 60 * 24));
      }

      if (!lastActivityDate) {
        // No activity that met requirement - cap at days since join
        // Never show "never active" - use days since join instead
        const effectiveDays = Math.min(daysSinceJoin, 999);
        const { category, warning_level } = getWarningInfo(effectiveDays);

        return {
          id: member.id,
          ign: member.ign,
          position: member.position,
          avatar_url: member.avatar_url,
          last_active_date: null,
          first_seen: member.first_seen,
          days_inactive: effectiveDays,
          category,
          warning_level,
        };
      }

      const lastDate = new Date(lastActivityDate);
      let daysDiff = Math.floor((today.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));

      // Cap days inactive at days since join (can't be inactive longer than membership)
      daysDiff = Math.min(daysDiff, daysSinceJoin);

      const { category, warning_level } = getWarningInfo(daysDiff);

      return {
        id: member.id,
        ign: member.ign,
        position: member.position,
        avatar_url: member.avatar_url,
        last_active_date: lastActivityDate,
        first_seen: member.first_seen,
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
      // Sort by days inactive (most inactive first)
      return b.days_inactive - a.days_inactive;
    });

  return NextResponse.json(inactiveMembers);
}
