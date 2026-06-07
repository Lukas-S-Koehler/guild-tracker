import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { getLastCompletedDay } from '@/lib/utils';
import { getWarningInfo, getISOWeekKey, findLastMetWeek } from '@/lib/warning-calculator';

// GET /api/dashboard
// Universal dashboard data across all guilds. Public — no auth required.
export async function GET(req: NextRequest) {
  const admin = createAdminClient();
  const today = getLastCompletedDay();
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 60);
  const cutoff = thirtyDaysAgo.toISOString().substring(0, 10);

  const [todayLogsRes, allTimeRes, guildsRes, membersRes, recentLogsRes, guildConfigsRes] = await Promise.all([
    admin
      .from('daily_logs')
      .select('id, raids, gold_donated, deposits_gold, met_requirement, guild_id, members (id, ign)')
      .eq('log_date', today)
      .order('met_requirement', { ascending: false }),

    admin.from('daily_logs').select('raids, gold_donated, deposits_gold'),

    admin.from('guilds').select('id, name, nickname'),

    admin
      .from('members')
      .select('id, ign, current_guild_id, first_seen, position, is_active')
      .eq('is_active', true),

    admin
      .from('daily_logs')
      .select('member_id, guild_id, log_date, met_requirement, deposits_gold')
      .gte('log_date', cutoff)
      .order('log_date', { ascending: false }),

    admin.from('guild_config').select('guild_id, settings'),
  ]);

  const todayLogs = todayLogsRes.data || [];
  const allLogs = allTimeRes.data || [];
  const guilds = guildsRes.data || [];
  const allMembers = membersRes.data || [];
  const recentLogs = recentLogsRes.data || [];
  const guildConfigs = guildConfigsRes.data || [];

  const guildMap: Record<string, { name: string; nickname: string }> = {};
  for (const g of guilds) {
    guildMap[g.id] = { name: g.name, nickname: g.nickname || g.name };
  }

  const configMap: Record<string, { period: string; weeklyReq: number; depositsOnly: boolean }> = {};
  for (const c of guildConfigs) {
    configMap[c.guild_id] = {
      period: c.settings?.requirement_period ?? 'daily',
      weeklyReq: c.settings?.weekly_donation_requirement ?? 35000,
      depositsOnly: c.settings?.deposits_only ?? false,
    };
  }

  // All-time totals
  const totalRaids = allLogs.reduce((s: number, l: any) => s + (l.raids || 0), 0);
  const totalGold = allLogs.reduce((s: number, l: any) => s + (l.gold_donated || 0) + (l.deposits_gold || 0), 0);

  const activeMembersCount = allMembers.length;

  // Per-member last-active date
  const lastMetMap = new Map<string, string>(); // member_id → last met date

  // Group recent logs by guild for weekly calculation
  const weeklyDepositsByMember = new Map<string, Map<string, number>>(); // member_id → weekKey → total

  for (const log of recentLogs) {
    const cfg = configMap[log.guild_id] ?? { period: 'daily', weeklyReq: 35000, depositsOnly: false };
    if (cfg.period === 'weekly') {
      const weekKey = getISOWeekKey(log.log_date);
      const goldVal = log.deposits_gold ?? 0;
      if (!weeklyDepositsByMember.has(log.member_id)) weeklyDepositsByMember.set(log.member_id, new Map());
      const memberWeeks = weeklyDepositsByMember.get(log.member_id)!;
      memberWeeks.set(weekKey, (memberWeeks.get(weekKey) ?? 0) + goldVal);
    } else {
      if (log.met_requirement && !lastMetMap.has(log.member_id)) {
        lastMetMap.set(log.member_id, log.log_date);
      }
    }
  }

  // Resolve weekly members
  weeklyDepositsByMember.forEach((weeks, memberId) => {
    const cfg = configMap[recentLogs.find(l => l.member_id === memberId)?.guild_id ?? ''] ?? { weeklyReq: 35000 };
    const lastSunday = findLastMetWeek(Object.fromEntries(Array.from(weeks.entries())), cfg.weeklyReq);
    if (lastSunday) lastMetMap.set(memberId, lastSunday.toISOString().split('T')[0]);
  });

  // Per-guild inactivity counts — anchor to last completed game day (yesterday's calendar date).
  // yesterday's log_date = log_date of game day that just ended (boundary 11:50 UTC).
  const _nowRef = new Date();
  const nowMs = new Date(Date.UTC(_nowRef.getUTCFullYear(), _nowRef.getUTCMonth(), _nowRef.getUTCDate() - 1)).getTime();
  const inactivityByGuild: Record<string, { guildName: string; warn1: number; warn2: number; kick: number }> = {};

  for (const member of allMembers) {
    if (!member.current_guild_id) continue;
    if (member.position === 'LEADER' || member.position === 'DEPUTY') continue;

    const guildId = member.current_guild_id;
    const cfg = configMap[guildId] ?? { period: 'daily' as const, weeklyReq: 35000, depositsOnly: false };
    const lastDate = lastMetMap.get(member.id);

    let daysSinceJoin = 999;
    if (member.first_seen) {
      daysSinceJoin = Math.max(0, Math.floor((nowMs - new Date(member.first_seen).getTime()) / 86400000));
    }

    let daysInactive: number;
    if (!lastDate) {
      daysInactive = Math.min(daysSinceJoin, 999);
    } else {
      daysInactive = Math.max(0, Math.floor((nowMs - new Date(lastDate + 'T00:00:00Z').getTime()) / 86400000));
      daysInactive = Math.min(daysInactive, daysSinceJoin);
    }

    const { warning_level } = getWarningInfo(daysInactive, cfg.period as 'daily' | 'weekly');
    if (warning_level === 'safe') continue;

    if (!inactivityByGuild[guildId]) {
      inactivityByGuild[guildId] = { guildName: guildMap[guildId]?.nickname ?? guildId, warn1: 0, warn2: 0, kick: 0 };
    }
    if (warning_level === 'warn1') inactivityByGuild[guildId].warn1++;
    else if (warning_level === 'warn2') inactivityByGuild[guildId].warn2++;
    else if (warning_level === 'kick') inactivityByGuild[guildId].kick++;
  }

  // Today's top contributor (by gold)
  let topContributor: { ign: string; gold: number; raids: number; guildName: string } | null = null;
  for (const log of todayLogs as any[]) {
    const gold = (log.gold_donated || 0) + (log.deposits_gold || 0);
    if (!topContributor || gold > topContributor.gold) {
      topContributor = {
        ign: log.members?.ign ?? '?',
        gold,
        raids: log.raids || 0,
        guildName: guildMap[log.guild_id]?.nickname ?? log.guild_id,
      };
    }
  }

  // Today's top guild (by total gold)
  const guildGoldToday: Record<string, { gold: number; raids: number; members: number }> = {};
  for (const log of todayLogs as any[]) {
    const gid = log.guild_id;
    if (!guildGoldToday[gid]) guildGoldToday[gid] = { gold: 0, raids: 0, members: 0 };
    guildGoldToday[gid].gold += (log.gold_donated || 0) + (log.deposits_gold || 0);
    guildGoldToday[gid].raids += log.raids || 0;
    guildGoldToday[gid].members++;
  }

  let topGuild: { name: string; gold: number; raids: number; memberCount: number } | null = null;
  for (const [gid, data] of Object.entries(guildGoldToday) as [string, { gold: number; raids: number; members: number }][]) {
    if (!topGuild || data.gold > topGuild.gold) {
      topGuild = { name: guildMap[gid]?.nickname ?? gid, gold: data.gold, raids: data.raids, memberCount: data.members };
    }
  }

  return NextResponse.json({
    date: today,
    today: todayLogs.map((l: any) => ({
      id: l.id,
      ign: l.members?.ign ?? '?',
      met_requirement: l.met_requirement,
      raids: l.raids || 0,
      gold: (l.gold_donated || 0) + (l.deposits_gold || 0),
      guild_name: guildMap[l.guild_id]?.nickname ?? l.guild_id,
    })),
    stats: {
      totalRaids,
      totalGold,
      totalActiveMembers: activeMembersCount,
      totalGuilds: guilds.length,
    },
    inactivityByGuild: Object.values(inactivityByGuild),
    topContributor,
    topGuild,
  });
}
