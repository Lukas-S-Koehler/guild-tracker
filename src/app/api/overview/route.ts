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
  shared_bank_covered: boolean;
  shared_bank_amount: number;
  bank_used: number;
  bank_earned: number;
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
  linked_members: Array<{ id: string; ign: string }>;
  bank_balance: number;
  combined_bank_balance: number;
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

type RawEntry = { gold: number; deposits: number; raids: number; met: boolean; bank_used: number; bank_earned: number; bank_balance_after: number };

function computeSharedBankCoverage(
  linkedIds: string[],
  columns: string[],
  rawLogsMap: Map<string, Map<string, RawEntry>>,
  preWindowBalances: Map<string, number>,
  overflowLimit: number,
  requirement: number,
  depositsOnly: boolean,
  lastActivityMap: Map<string, string>,
): Map<string, Map<string, number>> {
  const combinedLimit = overflowLimit * linkedIds.length;

  // Starting shared bank = sum of individual balances at start of display window
  let sharedBank = 0;
  for (const id of linkedIds) {
    sharedBank += Math.min(preWindowBalances.get(id) ?? 0, overflowLimit);
  }
  sharedBank = Math.min(sharedBank, combinedLimit);

  // col → amount used from shared bank (0 = not covered)
  const covered = new Map<string, Map<string, number>>(linkedIds.map(id => [id, new Map<string, number>()]));

  for (const col of columns) {
    let dayExcess = 0;
    const shortfalls: Array<{ id: string; amount: number }> = [];

    for (const id of linkedIds) {
      const entry = rawLogsMap.get(id)?.get(col);
      const raw = entry ? (depositsOnly ? entry.deposits : (entry.gold + entry.deposits)) : 0;
      if (raw >= requirement) {
        dayExcess += raw - requirement;
      } else {
        shortfalls.push({ id, amount: requirement - raw });
      }
    }

    sharedBank = Math.min(sharedBank + dayExcess, combinedLimit);

    // Sort: most inactive first (ascending last-activity date; empty string = never active = highest priority)
    shortfalls.sort((a, b) => {
      const la = lastActivityMap.get(a.id) ?? '';
      const lb = lastActivityMap.get(b.id) ?? '';
      return la < lb ? -1 : la > lb ? 1 : 0;
    });

    for (const { id, amount } of shortfalls) {
      if (sharedBank >= amount) {
        sharedBank -= amount;
        covered.get(id)!.set(col, amount);
        // Update so subsequent days reflect this coverage when re-sorting
        const existing = lastActivityMap.get(id);
        if (!existing || col > existing) lastActivityMap.set(id, col);
      }
    }
  }

  return covered;
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
    .select('id, ign, position, avatar_url, discord_id, first_seen, last_seen, is_active, hashed_id, character_id')
    .eq('current_guild_id', guildId)
    .eq('is_active', true);

  if (membersError) {
    return NextResponse.json({ error: membersError.message }, { status: 500 });
  }
  if (!members || members.length === 0) {
    return NextResponse.json({
      config: { period, donation_requirement: donationReq, weekly_donation_requirement: weeklyReq, guild_name: guildName, overflow_enabled: overflowEnabled, overflow_limit: overflowLimit },
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
    .select('member_id, log_date, gold_donated, deposits_gold, raids, met_requirement, bank_used, bank_earned, bank_balance_after')
    .eq('guild_id', guildId)
    .in('member_id', memberIds)
    .gte('log_date', fromDate)
    .order('log_date', { ascending: true });

  // Build periods map per member per column key
  // For weekly: aggregate by week key, recompute met_requirement
  const rawLogsMap = new Map<string, Map<string, RawEntry>>();

  if (period === 'weekly') {
    for (const log of logs ?? []) {
      const weekKey = getISOWeekKey(log.log_date);
      if (!columns.includes(weekKey)) continue;
      const memberMap = rawLogsMap.get(log.member_id) ?? new Map();
      const existing = memberMap.get(weekKey) ?? { gold: 0, deposits: 0, raids: 0, met: false, bank_used: 0, bank_earned: 0, bank_balance_after: 0 };
      existing.gold += log.gold_donated ?? 0;
      existing.deposits += log.deposits_gold ?? 0;
      existing.raids += log.raids ?? 0;
      existing.bank_used += log.bank_used ?? 0;
      existing.bank_earned += log.bank_earned ?? 0;
      existing.bank_balance_after = log.bank_balance_after ?? 0; // last day's balance in week
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
        bank_balance_after: log.bank_balance_after ?? 0,
      });
      rawLogsMap.set(log.member_id, memberMap);
    }
  }

  // Fetch alt links — both directions to catch external-main pairs
  const [{ data: mainInGuildLinks }, { data: altInGuildLinks }] = await Promise.all([
    supabase.from('member_alts').select('member_id, alt_member_id')
      .in('member_id', memberIds).not('alt_member_id', 'is', null),
    supabase.from('member_alts').select('member_id, alt_member_id')
      .in('alt_member_id', memberIds).not('alt_member_id', 'is', null),
  ]);

  const altToMain = new Map<string, string>();
  const mainToAlts = new Map<string, string[]>();

  // Links where main is in guild
  for (const link of mainInGuildLinks ?? []) {
    if (!link.alt_member_id || !memberSet.has(link.alt_member_id)) continue;
    altToMain.set(link.alt_member_id, link.member_id);
    const arr = mainToAlts.get(link.member_id) ?? [];
    arr.push(link.alt_member_id);
    mainToAlts.set(link.member_id, arr);
  }

  // Links where main is external — group in-guild alts sharing the same external main
  const memberCharIdMap = new Map(members.map(m => [m.id, (m as any).character_id ?? Infinity]));
  const externalGroups = new Map<string, string[]>();
  for (const link of altInGuildLinks ?? []) {
    if (!link.alt_member_id || !memberSet.has(link.alt_member_id)) continue;
    if (memberSet.has(link.member_id)) continue; // handled by mainInGuildLinks
    const arr = externalGroups.get(link.member_id) ?? [];
    arr.push(link.alt_member_id);
    externalGroups.set(link.member_id, arr);
  }
  for (const [, peerIds] of Array.from(externalGroups)) {
    if (peerIds.length < 2) continue;
    const sorted = [...peerIds].sort(
      (a, b) => (memberCharIdMap.get(a) ?? Infinity) - (memberCharIdMap.get(b) ?? Infinity)
    );
    const effectiveMain = sorted[0];
    for (const altId of sorted.slice(1)) {
      if (altToMain.has(altId)) continue;
      altToMain.set(altId, effectiveMain);
      const arr = mainToAlts.get(effectiveMain) ?? [];
      arr.push(altId);
      mainToAlts.set(effectiveMain, arr);
    }
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

  // Compute live bank balance: latest log's bank_balance_after drained to today.
  const { data: bankLogRows } = await supabase
    .from('daily_logs')
    .select('member_id, log_date, bank_balance_after')
    .eq('guild_id', guildId)
    .in('member_id', memberIds)
    .lte('log_date', todayStr)
    .order('log_date', { ascending: false });

  const latestBankLog = new Map<string, { log_date: string; bank_balance_after: number }>();
  for (const row of bankLogRows ?? []) {
    if (!latestBankLog.has(row.member_id)) {
      latestBankLog.set(row.member_id, { log_date: row.log_date, bank_balance_after: row.bank_balance_after ?? 0 });
    }
  }

  const bankBalanceMap = new Map<string, number>();
  for (const memberId of memberIds) {
    const latest = latestBankLog.get(memberId);
    if (!latest || latest.bank_balance_after === 0) {
      bankBalanceMap.set(memberId, 0);
      continue;
    }
    const daysSinceLog = Math.round(
      (new Date(todayStr + 'T00:00:00Z').getTime() - new Date(latest.log_date + 'T00:00:00Z').getTime()) / 86400000
    );
    let balance = latest.bank_balance_after;
    for (let i = 0; i < daysSinceLog && balance > 0; i++) {
      balance = Math.max(0, balance - donationReq);
    }
    bankBalanceMap.set(memberId, balance);
  }

  // Build inactivity map — own activity only, no cross-member inheritance
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

  // Compute pre-window bank balances and inferred bank states for inactive days.
  // Must happen before shared bank coverage so preWindowBalances can be passed in.
  const inferredBankMap = new Map<string, Map<string, { bank_used: number; met_requirement: boolean }>>();
  const preWindowBalances = new Map<string, number>(); // balance at start of columns[0]

  if (period === 'daily') {
    // memberId → date → bank_balance_after
    const allBankByDate = new Map<string, Map<string, number>>();
    for (const row of bankLogRows ?? []) {
      const m = allBankByDate.get(row.member_id) ?? new Map<string, number>();
      m.set(row.log_date, row.bank_balance_after ?? 0);
      allBankByDate.set(row.member_id, m);
    }

    for (const memberId of memberIds) {
      const memberLogDates = rawLogsMap.get(memberId);
      const bankByDate = allBankByDate.get(memberId) ?? new Map<string, number>();

      // Find latest log before first column → starting balance for the window
      let latestBeforeWindow: string | null = null;
      for (const [date] of Array.from(bankByDate.entries())) {
        if (date < columns[0] && (latestBeforeWindow === null || date > latestBeforeWindow)) {
          latestBeforeWindow = date;
        }
      }
      let startBalance = 0;
      if (latestBeforeWindow) {
        startBalance = bankByDate.get(latestBeforeWindow) ?? 0;
        const gapDays = Math.round(
          (new Date(columns[0] + 'T00:00:00Z').getTime() - new Date(latestBeforeWindow + 'T00:00:00Z').getTime()) / 86400000
        ) - 1;
        for (let i = 0; i < gapDays && startBalance > 0; i++) {
          startBalance = Math.max(0, startBalance - donationReq);
        }
      }
      preWindowBalances.set(memberId, startBalance);

      const colInferred = new Map<string, { bank_used: number; met_requirement: boolean }>();
      let runningBalance = startBalance;

      for (const col of columns) {
        const entry = memberLogDates?.get(col);
        if (entry) {
          runningBalance = entry.bank_balance_after > 0
            ? entry.bank_balance_after
            : Math.max(0, runningBalance + entry.bank_earned - entry.bank_used);
        } else if (runningBalance > 0) {
          const bank_used = Math.min(donationReq, runningBalance);
          colInferred.set(col, { bank_used, met_requirement: runningBalance >= donationReq });
          runningBalance = Math.max(0, runningBalance - donationReq);
        }
      }

      if (colInferred.size > 0) inferredBankMap.set(memberId, colInferred);
    }
  }

  // Update lastActivityMap for inactive days covered by individual bank
  if (period === 'daily') {
    for (const [memberId, colMap] of Array.from(inferredBankMap)) {
      for (const [col, inferred] of Array.from(colMap)) {
        if (inferred.met_requirement) {
          const existing = lastActivityMap.get(memberId);
          if (!existing || col > existing) lastActivityMap.set(memberId, col);
        }
      }
    }
  }

  // Compute shared bank coverage for each linked group
  const altMemberIds = new Set(Array.from(altToMain.keys()));
  const processedInGroup = new Set<string>();
  const sharedBankCoveredMap = new Map<string, Map<string, number>>();
  const effectiveReq = period === 'weekly' ? weeklyReq : donationReq;

  for (const memberId of memberIds) {
    if (processedInGroup.has(memberId)) continue;

    const altIds = (mainToAlts.get(memberId) ?? []).filter(id => memberSet.has(id));

    if (altIds.length > 0) {
      const groupIds = [memberId, ...altIds];
      const groupCoverage = computeSharedBankCoverage(
        groupIds, columns, rawLogsMap, preWindowBalances,
        overflowLimit, effectiveReq, depositsOnly, lastActivityMap
      );
      for (const [id, cols] of Array.from(groupCoverage)) {
        sharedBankCoveredMap.set(id, cols);
        processedInGroup.add(id);
      }
    } else if (!altToMain.has(memberId)) {
      sharedBankCoveredMap.set(memberId, new Map());
      processedInGroup.add(memberId);
    }
  }

  // Update lastActivityMap for shared-bank-covered days
  for (const [memberId, coveredColsMap] of Array.from(sharedBankCoveredMap)) {
    let latestCovered: string | null = null;
    for (const col of Array.from(coveredColsMap.keys())) {
      const colDate = period === 'weekly' ? getWeekStart(col) : col;
      if (!latestCovered || colDate > latestCovered) latestCovered = colDate;
    }
    if (latestCovered) {
      const existing = lastActivityMap.get(memberId);
      if (!existing || latestCovered > existing) lastActivityMap.set(memberId, latestCovered);
    }
  }

  const buildPeriods = (
    memberId: string,
    coveredColsMap: Map<string, number>,
    firstSeen?: string | null
  ): Record<string, OverviewPeriod> => {
    const result: Record<string, OverviewPeriod> = {};
    const memberPeriods = rawLogsMap.get(memberId);
    const memberInferred = inferredBankMap.get(memberId);

    for (const col of columns) {
      if (firstSeen) {
        const colDate = period === 'weekly' ? getWeekStart(col) : col;
        if (colDate < firstSeen) continue;
      }
      const entry = memberPeriods?.get(col);
      const inferred = !entry ? memberInferred?.get(col) : undefined;

      const gold = entry?.gold ?? 0;
      const deps = entry?.deposits ?? 0;
      const raids = entry?.raids ?? 0;
      const bankUsed = entry?.bank_used ?? inferred?.bank_used ?? 0;
      const met = entry?.met ?? inferred?.met_requirement ?? false;
      const shared_bank_amount = coveredColsMap.get(col) ?? 0;
      const shared_bank_covered = !met && shared_bank_amount > 0;
      // include individual bank_used and shared bank in cell status calculation
      const status = cellStatus(gold + deps + bankUsed + shared_bank_amount, met || shared_bank_covered);

      result[col] = {
        gold_donated: gold,
        deposits_gold: deps,
        raids,
        met_requirement: met,
        cell_status: status,
        shared_bank_covered,
        shared_bank_amount,
        bank_used: bankUsed,
        bank_earned: entry?.bank_earned ?? 0,
      };
    }
    return result;
  };

  const ADMIN_HASHED_IDS = new Set([
    '6aDoyRnLyEey9LpV5AGX',
    'AB1E9poQq7VOKYnakeJj',
    'o31P7kZL6Z31BLveGxXO',
  ]);

  const summary = { safe: 0, warn1: 0, warn2: 0, kick: 0 };

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
      // Include siblings: if this member is an alt, also include the main's other alts
      const siblingIds = mainId
        ? (mainToAlts.get(mainId) ?? []).filter(id => id !== member.id && memberSet.has(id))
        : [];
      const linkedIds = [
        ...altIds,
        ...(mainId && memberSet.has(mainId) ? [mainId] : []),
        ...siblingIds,
      ];

      const linked_members = linkedIds.map(lid => ({
        id: lid,
        ign: members.find(m => m.id === lid)?.ign ?? lid,
      }));

      const combined_bank_balance = [member.id, ...linkedIds].reduce(
        (s, id) => s + (bankBalanceMap.get(id) ?? 0), 0
      );

      // Days inactive — use last completed game day as anchor (yesterday), not current game day
      const refMs = inactivityAnchor.getTime();
      const lastDate = lastActivityMap.get(member.id);
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

      const coveredCols = sharedBankCoveredMap.get(member.id) ?? new Map<string, number>();

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
        periods: buildPeriods(member.id, coveredCols, member.first_seen),
        linked_members,
        bank_balance: bankBalanceMap.get(member.id) ?? 0,
        combined_bank_balance,
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
