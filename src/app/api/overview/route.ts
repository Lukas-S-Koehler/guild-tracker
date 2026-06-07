import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { verifyAuthOrPublic, isErrorResponse } from '@/lib/auth-helpers';
import { getWarningInfo, findLastMetWeek, getISOWeekKey, RequirementPeriod } from '@/lib/warning-calculator';

export interface OverviewPeriod {
  gold_donated: number;
  deposits_gold: number;
  raids: number;
  met_requirement: boolean;
  cell_status: 'green' | 'yellow' | 'red';
  alt_covered: boolean;
  bank_used: number;
  bank_earned: number;
}

export interface OverviewAlt {
  id: string;
  ign: string;
  periods: Record<string, Omit<OverviewPeriod, 'alt_covered' | 'bank_used' | 'bank_earned'>>;
}

export interface OverviewMember {
  id: string;
  ign: string;
  position: string;
  avatar_url: string | null;
  discord_id: string | null;
  first_seen: string | null;
  days_inactive: number;
  warning_level: 'safe' | 'warn1' | 'warn2' | 'kick';
  recent_warning: 'warn1' | 'warn2' | 'kick' | null;
  is_alt: boolean;
  main_id: string | null;
  periods: Record<string, OverviewPeriod>;
  alts: OverviewAlt[];
  bank_balance: number;
}

export interface OverviewResponse {
  config: {
    period: RequirementPeriod;
    donation_requirement: number;
    weekly_donation_requirement: number;
    guild_name: string;
    overflow_enabled: boolean;
    overflow_limit: number;
  };
  columns: string[];
  members: OverviewMember[];
  summary: { safe: number; warn1: number; warn2: number; kick: number };
}

function getColumnKeys(period: RequirementPeriod, todayStr: string): string[] {
  if (period === 'weekly') {
    const cols: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(todayStr + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() - i * 7);
      cols.push(getISOWeekKey(d.toISOString().split('T')[0]));
    }
    // Deduplicate while preserving order
    return Array.from(new Set(cols));
  } else {
    const cols: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(todayStr + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() - i);
      cols.push(d.toISOString().split('T')[0]);
    }
    return cols;
  }
}

function getWeekStart(weekKey: string): string {
  const [yearStr, weekStr] = weekKey.split('-W');
  const year = parseInt(yearStr);
  const week = parseInt(weekStr);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dayOfWeek = jan4.getUTCDay() || 7;
  const monday1 = new Date(jan4);
  monday1.setUTCDate(jan4.getUTCDate() - dayOfWeek + 1);
  const targetMonday = new Date(monday1);
  targetMonday.setUTCDate(monday1.getUTCDate() + (week - 1) * 7);
  return targetMonday.toISOString().split('T')[0];
}

function cellStatus(gold: number, met: boolean): 'green' | 'yellow' | 'red' {
  if (met) return 'green';
  if (gold > 0) return 'yellow';
  return 'red';
}

export async function GET(req: NextRequest) {
  const auth = await verifyAuthOrPublic(req);
  if (isErrorResponse(auth)) return auth;

  const { guildId } = auth;
  if (!guildId) {
    return NextResponse.json({ error: 'Guild ID required' }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Fetch guild config
  const { data: configRow } = await supabase
    .from('guild_config')
    .select('settings, guild_name, donation_requirement')
    .eq('guild_id', guildId)
    .single();

  const period: RequirementPeriod = configRow?.settings?.requirement_period ?? 'daily';
  const weeklyReq: number = configRow?.settings?.weekly_donation_requirement ?? 35000;
  const depositsOnly: boolean = configRow?.settings?.deposits_only ?? false;
  const donationReq: number = configRow?.donation_requirement ?? 5000;
  const guildName: string = configRow?.guild_name ?? guildId;
  const overflowEnabled: boolean = configRow?.settings?.overflow_enabled ?? true;
  const overflowLimit: number = configRow?.settings?.overflow_limit ?? 10000;

  const now = new Date();

  // Use last completed game day for both columns and inactivity anchor.
  // log_date of completed game day = yesterday's calendar date (game boundary 11:50 UTC).
  // This keeps the grid and the days_inactive count consistent — if yesterday's column is green, 0d inactive.
  const inactivityAnchor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const todayStr = inactivityAnchor.toISOString().split('T')[0];

  const columns = getColumnKeys(period, todayStr);

  // Fetch active members
  const { data: members, error: membersError } = await supabase
    .from('members')
    .select('id, ign, position, avatar_url, discord_id, first_seen, last_seen, is_active, hashed_id')
    .eq('current_guild_id', guildId)
    .eq('is_active', true);

  if (membersError) {
    return NextResponse.json({ error: membersError.message }, { status: 500 });
  }
  if (!members || members.length === 0) {
    return NextResponse.json({
      config: { period, donation_requirement: donationReq, weekly_donation_requirement: weeklyReq, guild_name: guildName },
      columns,
      members: [],
      summary: { safe: 0, warn1: 0, warn2: 0, kick: 0 },
    });
  }

  const memberIds = members.map((m) => m.id);
  const memberSet = new Set(memberIds);

  // Date range for logs
  const fromDate = period === 'weekly' ? getWeekStart(columns[0]) : columns[0];

  const { data: logs } = await supabase
    .from('daily_logs')
    .select('member_id, log_date, gold_donated, deposits_gold, raids, met_requirement, bank_used, bank_earned')
    .eq('guild_id', guildId)
    .in('member_id', memberIds)
    .gte('log_date', fromDate)
    .order('log_date', { ascending: true });

  // Build periods map per member per column key
  // For weekly: aggregate by week key, recompute met_requirement
  const rawLogsMap = new Map<string, Map<string, { gold: number; deposits: number; raids: number; met: boolean; bank_used: number; bank_earned: number }>>();

  if (period === 'weekly') {
    for (const log of logs ?? []) {
      const weekKey = getISOWeekKey(log.log_date);
      if (!columns.includes(weekKey)) continue;
      const memberMap = rawLogsMap.get(log.member_id) ?? new Map();
      const existing = memberMap.get(weekKey) ?? { gold: 0, deposits: 0, raids: 0, met: false, bank_used: 0, bank_earned: 0 };
      existing.gold += log.gold_donated ?? 0;
      existing.deposits += log.deposits_gold ?? 0;
      existing.raids += log.raids ?? 0;
      existing.bank_used += log.bank_used ?? 0;
      existing.bank_earned += log.bank_earned ?? 0;
      // Recompute met based on accumulated total
      const total = depositsOnly ? existing.deposits : (existing.gold + existing.deposits);
      existing.met = total >= weeklyReq;
      memberMap.set(weekKey, existing);
      rawLogsMap.set(log.member_id, memberMap);
    }
    // Correct weekly met: recalculate after all logs aggregated
    rawLogsMap.forEach((weekMap, memberId) => {
      weekMap.forEach((entry, wk) => {
        const total = depositsOnly ? entry.deposits : (entry.deposits + entry.gold);
        entry.met = total >= weeklyReq;
        weekMap.set(wk, entry);
      });
      rawLogsMap.set(memberId, weekMap);
    });
  } else {
    for (const log of logs ?? []) {
      if (!columns.includes(log.log_date)) continue;
      const memberMap = rawLogsMap.get(log.member_id) ?? new Map();
      memberMap.set(log.log_date, {
        gold: log.gold_donated ?? 0,
        deposits: log.deposits_gold ?? 0,
        raids: log.raids ?? 0,
        met: log.met_requirement ?? false,
        bank_used: log.bank_used ?? 0,
        bank_earned: log.bank_earned ?? 0,
      });
      rawLogsMap.set(log.member_id, memberMap);
    }
  }

  // Fetch alt links
  const { data: altLinks } = await supabase
    .from('member_alts')
    .select('member_id, alt_member_id')
    .in('member_id', memberIds)
    .not('alt_member_id', 'is', null);

  const altToMain = new Map<string, string>();
  const mainToAlts = new Map<string, string[]>();
  for (const link of altLinks ?? []) {
    if (!link.alt_member_id || !memberSet.has(link.alt_member_id)) continue;
    altToMain.set(link.alt_member_id, link.member_id);
    const arr = mainToAlts.get(link.member_id) ?? [];
    arr.push(link.alt_member_id);
    mainToAlts.set(link.member_id, arr);
  }

  // Fetch recent warnings (last 7 days, highest level per member)
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 7);
  const { data: recentWarnings } = await supabase
    .from('warnings')
    .select('member_id, warning_level, created_at')
    .eq('guild_id', guildId)
    .in('member_id', memberIds)
    .gte('created_at', sevenDaysAgo.toISOString())
    .order('created_at', { ascending: false });

  const levelRank: Record<string, number> = { warn1: 1, warn2: 2, kick: 3 };
  const recentWarningMap = new Map<string, 'warn1' | 'warn2' | 'kick'>();
  for (const w of recentWarnings ?? []) {
    const existing = recentWarningMap.get(w.member_id);
    if (!existing || (levelRank[w.warning_level] ?? 0) > (levelRank[existing] ?? 0)) {
      recentWarningMap.set(w.member_id, w.warning_level as 'warn1' | 'warn2' | 'kick');
    }
  }

  // Fetch bank balances
  const { data: bankRows } = await supabase
    .from('member_gold_bank')
    .select('member_id, balance')
    .eq('guild_id', guildId)
    .in('member_id', memberIds);
  const bankBalanceMap = new Map<string, number>();
  for (const row of bankRows ?? []) {
    bankBalanceMap.set(row.member_id, row.balance ?? 0);
  }

  // Build inactivity map — only consider logs up to todayStr (= inactivityAnchor = yesterday).
  // Donations in the new game day (log_date > todayStr) must not mask missed activity in checked day.
  const lastActivityMap = new Map<string, string>();
  if (period === 'weekly') {
    // Fetch all logs for weekly calculation (need more than just 7 weeks for inactivity)
    const { data: allLogs } = await supabase
      .from('daily_logs')
      .select('member_id, log_date, deposits_gold, gold_donated')
      .eq('guild_id', guildId)
      .in('member_id', memberIds)
      .lte('log_date', todayStr)
      .order('log_date', { ascending: false })
      .limit(1000);

    const weeklyMap = new Map<string, Map<string, number>>();
    for (const log of allLogs ?? []) {
      const goldVal = depositsOnly ? (log.deposits_gold ?? 0) : ((log.gold_donated ?? 0) + (log.deposits_gold ?? 0));
      const wk = getISOWeekKey(log.log_date);
      const mw = weeklyMap.get(log.member_id) ?? new Map<string, number>();
      mw.set(wk, (mw.get(wk) ?? 0) + goldVal);
      weeklyMap.set(log.member_id, mw);
    }
    weeklyMap.forEach((weeks, memberId) => {
      const lastMetSunday = findLastMetWeek(Object.fromEntries(Array.from(weeks.entries())), weeklyReq);
      if (lastMetSunday) {
        lastActivityMap.set(memberId, lastMetSunday.toISOString().split('T')[0]);
      }
    });
  } else {
    const { data: metLogs } = await supabase
      .from('daily_logs')
      .select('member_id, log_date')
      .eq('guild_id', guildId)
      .eq('met_requirement', true)
      .in('member_id', memberIds)
      .lte('log_date', todayStr)
      .order('log_date', { ascending: false })
      .limit(365);
    for (const log of metLogs ?? []) {
      if (!lastActivityMap.has(log.member_id)) {
        lastActivityMap.set(log.member_id, log.log_date);
      }
    }
  }

  // Alt coverage check for last activity
  for (const member of members) {
    let lastDate = lastActivityMap.get(member.id);
    const altIds = (mainToAlts.get(member.id) ?? []).filter((aid) => memberSet.has(aid));
    for (const altId of altIds) {
      const altLast = lastActivityMap.get(altId);
      if (altLast && (!lastDate || altLast > lastDate)) lastDate = altLast;
    }
    const mainId = altToMain.get(member.id);
    if (mainId && memberSet.has(mainId)) {
      const mainLast = lastActivityMap.get(mainId);
      if (mainLast && (!lastDate || mainLast > lastDate)) lastDate = mainLast;
    }
    if (lastDate) lastActivityMap.set(member.id, lastDate);
  }

  // Build member result rows
  const altMemberIds = new Set(Array.from(altToMain.keys()));
  const summary = { safe: 0, warn1: 0, warn2: 0, kick: 0 };

  const buildPeriods = (
    memberId: string,
    includeAltCovered: boolean,
    altIds: string[]
  ): Record<string, OverviewPeriod> => {
    const result: Record<string, OverviewPeriod> = {};
    const memberPeriods = rawLogsMap.get(memberId);

    for (const col of columns) {
      const entry = memberPeriods?.get(col);
      const gold = entry?.gold ?? 0;
      const deps = entry?.deposits ?? 0;
      const raids = entry?.raids ?? 0;
      const met = entry?.met ?? false;
      const status = cellStatus(gold + deps, met);

      let altCovered = false;
      if (includeAltCovered && !met) {
        // Check if any same-guild alt has double contribution for this period
        for (const altId of altIds) {
          const altEntry = rawLogsMap.get(altId)?.get(col);
          if (!altEntry) continue;
          const altTotal = depositsOnly ? altEntry.deposits : (altEntry.gold + altEntry.deposits);
          const threshold = period === 'weekly' ? weeklyReq * 2 : donationReq * 2;
          if (altTotal >= threshold) {
            altCovered = true;
            break;
          }
        }
      }

      result[col] = {
        gold_donated: gold,
        deposits_gold: deps,
        raids,
        met_requirement: met,
        cell_status: status,
        alt_covered: altCovered,
        bank_used: entry?.bank_used ?? 0,
        bank_earned: entry?.bank_earned ?? 0,
      };
    }
    return result;
  };

  const buildAltPeriods = (altId: string): Record<string, Omit<OverviewPeriod, 'alt_covered' | 'bank_used' | 'bank_earned'>> => {
    const result: Record<string, Omit<OverviewPeriod, 'alt_covered' | 'bank_used' | 'bank_earned'>> = {};
    const altPeriods = rawLogsMap.get(altId);
    for (const col of columns) {
      const entry = altPeriods?.get(col);
      const gold = entry?.gold ?? 0;
      const deps = entry?.deposits ?? 0;
      const raids = entry?.raids ?? 0;
      const met = entry?.met ?? false;
      result[col] = { gold_donated: gold, deposits_gold: deps, raids, met_requirement: met, cell_status: cellStatus(gold + deps, met) };
    }
    return result;
  };

  const ADMIN_HASHED_IDS = new Set([
    '6aDoyRnLyEey9LpV5AGX',
    'AB1E9poQq7VOKYnakeJj',
    'o31P7kZL6Z31BLveGxXO',
  ]);

  const resultMembers: OverviewMember[] = members
    .filter((m) => {
      if (!m.ign || m.ign.toLowerCase().includes('raw activity') || m.ign.toLowerCase().includes('log')) return false;
      if (m.position === 'LEADER' || m.position === 'DEPUTY') return false;
      if (m.hashed_id && ADMIN_HASHED_IDS.has(m.hashed_id)) return false;
      return true;
    })
    .map((member) => {
      const isAlt = altMemberIds.has(member.id);
      const mainId = altToMain.get(member.id) ?? null;
      const altIds = (mainToAlts.get(member.id) ?? []).filter((aid) => memberSet.has(aid));

      // Days inactive — use last completed game day as anchor (yesterday), not current game day
      const refMs = inactivityAnchor.getTime();
      let lastDate = lastActivityMap.get(member.id);
      let daysSinceJoin = 999;
      if (member.first_seen) {
        daysSinceJoin = Math.max(0, Math.floor((refMs - new Date(member.first_seen).getTime()) / 86400000));
      }
      let daysInactive: number;
      if (!lastDate) {
        daysInactive = Math.min(daysSinceJoin, 999);
      } else {
        const d = Math.max(0, Math.floor((refMs - new Date(lastDate + 'T00:00:00Z').getTime()) / 86400000));
        daysInactive = Math.min(d, daysSinceJoin);
      }
      const { warning_level } = getWarningInfo(daysInactive, period);
      summary[warning_level]++;

      const alts: OverviewAlt[] = altIds.map((altId) => {
        const altMember = members.find((m) => m.id === altId);
        return {
          id: altId,
          ign: altMember?.ign ?? altId,
          periods: buildAltPeriods(altId),
        };
      });

      return {
        id: member.id,
        ign: member.ign,
        position: member.position,
        avatar_url: member.avatar_url ?? null,
        discord_id: member.discord_id ?? null,
        first_seen: member.first_seen ?? null,
        days_inactive: daysInactive,
        warning_level,
        recent_warning: recentWarningMap.get(member.id) ?? null,
        is_alt: isAlt,
        main_id: mainId,
        periods: buildPeriods(member.id, true, altIds),
        alts,
        bank_balance: bankBalanceMap.get(member.id) ?? 0,
      };
    })
    .sort((a, b) => b.days_inactive - a.days_inactive);

  return NextResponse.json({
    config: {
      period,
      donation_requirement: donationReq,
      weekly_donation_requirement: weeklyReq,
      guild_name: guildName,
      overflow_enabled: overflowEnabled,
      overflow_limit: overflowLimit,
    },
    columns,
    members: resultMembers,
    summary,
  } satisfies OverviewResponse);
}
