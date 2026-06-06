import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { verifyAuthOrPublic, isErrorResponse } from '@/lib/auth-helpers';
import { getWarningInfo, findLastMetWeek, getISOWeekKey, RequirementPeriod } from '@/lib/warning-calculator';

// GET /api/reports/inactivity — public, no auth required
export async function GET(req: NextRequest) {
  const auth = await verifyAuthOrPublic(req);
  if (isErrorResponse(auth)) return auth;

  const { guildId } = auth;
  const supabase = createAdminClient();

  // Fetch guild active status + config
  const [{ data: guild }, { data: config }] = await Promise.all([
    supabase.from('guilds').select('is_active').eq('id', guildId).single(),
    supabase.from('guild_config').select('settings').eq('guild_id', guildId).single(),
  ]);

  if (guild?.is_active === false) return NextResponse.json([]);

  const period: RequirementPeriod = config?.settings?.requirement_period ?? 'daily';
  const weeklyReq: number = config?.settings?.weekly_donation_requirement ?? 35000;
  const depositsOnly: boolean = config?.settings?.deposits_only ?? false;

  const { data: members, error: membersError } = await supabase
    .from('members')
    .select('id, ign, position, avatar_url, last_seen, first_seen, is_active, discord_id')
    .eq('current_guild_id', guildId)
    .eq('is_active', true);

  if (membersError) {
    return NextResponse.json({ error: membersError.message }, { status: 500 });
  }

  if (!members || members.length === 0) {
    return NextResponse.json([]);
  }

  const memberIds = members.map((m) => m.id);

  // today = last completed game day = yesterday's calendar date.
  // Robust regardless of when this is called (game boundary 11:50 UTC; completed day log_date = yesterday).
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  // Upper bound for log queries: donations in the new game day (log_date > today) must not
  // mask missed activity in the checked day.
  const todayStr = today.toISOString().split('T')[0];

  // Fetch logs — for weekly guilds we need deposits_gold, for daily we filter by met_requirement
  let logs: Array<{ member_id: string; log_date: string; met_requirement: boolean; deposits_gold: number; gold_donated?: number }> = [];

  if (period === 'weekly') {
    const { data } = await supabase
      .from('daily_logs')
      .select('member_id, log_date, met_requirement, deposits_gold, gold_donated')
      .eq('guild_id', guildId)
      .in('member_id', memberIds)
      .lte('log_date', todayStr)
      .order('log_date', { ascending: false })
      .limit(1000);
    logs = data ?? [];
  } else {
    const { data } = await supabase
      .from('daily_logs')
      .select('member_id, log_date, met_requirement, deposits_gold')
      .eq('guild_id', guildId)
      .eq('met_requirement', true)
      .in('member_id', memberIds)
      .lte('log_date', todayStr)
      .order('log_date', { ascending: false })
      .limit(365);
    logs = data ?? [];
  }

  // Build last-activity map per member
  const lastActivityMap = new Map<string, string>();

  if (period === 'weekly') {
    const weeklyMap = new Map<string, Map<string, number>>();
    for (const log of logs) {
      const goldValue = depositsOnly ? (log.deposits_gold ?? 0) : ((log.gold_donated ?? 0) + (log.deposits_gold ?? 0));
      const weekKey = getISOWeekKey(log.log_date);
      const memberWeeks = weeklyMap.get(log.member_id) ?? new Map<string, number>();
      memberWeeks.set(weekKey, (memberWeeks.get(weekKey) ?? 0) + goldValue);
      weeklyMap.set(log.member_id, memberWeeks);
    }
    Array.from(weeklyMap.entries()).forEach(([memberId, weeks]) => {
      const lastMetSunday = findLastMetWeek(Object.fromEntries(Array.from(weeks.entries())), weeklyReq);
      if (lastMetSunday) {
        lastActivityMap.set(memberId, lastMetSunday.toISOString().split('T')[0]);
      }
    });
  } else {
    for (const log of logs) {
      if (!lastActivityMap.has(log.member_id)) {
        lastActivityMap.set(log.member_id, log.log_date);
      }
    }
  }

  // Fetch alt relationships
  const { data: altLinks } = await supabase
    .from('member_alts')
    .select('member_id, alt_member_id')
    .in('member_id', memberIds)
    .not('alt_member_id', 'is', null);

  const memberSet = new Set(memberIds);
  const altToMain = new Map<string, string>();
  const mainToAlts = new Map<string, string[]>();
  for (const link of altLinks ?? []) {
    if (!link.alt_member_id) continue;
    altToMain.set(link.alt_member_id, link.member_id);
    const arr = mainToAlts.get(link.member_id) ?? [];
    arr.push(link.alt_member_id);
    mainToAlts.set(link.member_id, arr);
  }

  const inactiveMembers = members
    .map((member) => {
      let lastDate = lastActivityMap.get(member.id);
      let altCovered = false;

      // Check same-guild alts for coverage
      const altIds = mainToAlts.get(member.id) ?? [];
      const altInGuild = altIds.filter((aid) => memberSet.has(aid));
      for (const altId of altInGuild) {
        const altLast = lastActivityMap.get(altId);
        if (altLast && (!lastDate || altLast > lastDate)) {
          lastDate = altLast;
          altCovered = true;
        }
      }
      // Also check if this member is an alt of someone else in the guild
      const mainId = altToMain.get(member.id);
      if (mainId && memberSet.has(mainId)) {
        const mainLast = lastActivityMap.get(mainId);
        if (mainLast && (!lastDate || mainLast > lastDate)) {
          lastDate = mainLast;
          altCovered = true;
        }
      }

      let daysSinceJoin = 999;
      if (member.first_seen) {
        const joinDate = new Date(member.first_seen);
        daysSinceJoin = Math.floor((today.getTime() - joinDate.getTime()) / (1000 * 60 * 60 * 24));
      }

      let daysInactive: number;
      if (!lastDate) {
        daysInactive = Math.min(daysSinceJoin, 999);
      } else {
        const lastDateObj = new Date(lastDate + 'T00:00:00Z');
        daysInactive = Math.max(0, Math.floor((today.getTime() - lastDateObj.getTime()) / (1000 * 60 * 60 * 24)));
        daysInactive = Math.min(daysInactive, daysSinceJoin);
      }

      const { category, warning_level } = getWarningInfo(daysInactive, period);

      const hasAlts = altIds.length > 0 || !!altToMain.get(member.id);

      return {
        id: member.id,
        ign: member.ign,
        position: member.position,
        avatar_url: member.avatar_url,
        last_active_date: lastDate ?? null,
        first_seen: member.first_seen,
        days_inactive: daysInactive,
        category,
        warning_level,
        has_alts: hasAlts,
        alt_covered: altCovered,
        discord_id: member.discord_id ?? null,
      };
    })
    .filter((m) => {
      if (!m.ign || m.ign.toLowerCase().includes('raw activity') || m.ign.toLowerCase().includes('log')) {
        return false;
      }
      if (m.position === 'LEADER' || m.position === 'DEPUTY') return false;
      return m.category !== 'active';
    })
    .sort((a, b) => b.days_inactive - a.days_inactive);

  return NextResponse.json(inactiveMembers);
}
