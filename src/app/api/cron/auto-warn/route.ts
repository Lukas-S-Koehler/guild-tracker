import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { verifyAuth, isErrorResponse } from '@/lib/auth-helpers';
import { sendDirectMessage, postToChannel } from '@/lib/discord-api';
import { getWarningInfo, getEffectiveDaysInactive, findLastMetWeek, getISOWeekKey, getWeekSunday, getWeekKeyRange, RequirementPeriod } from '@/lib/warning-calculator';

// POST /api/cron/auto-warn — auto-warn inactive members
// Accepts either CRON_SECRET (all guilds) or officer session (single guild via x-guild-id)
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('Authorization');
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const guildIdHeader = req.headers.get('x-guild-id');

  if (!isCron) {
    // Try officer session auth
    const auth = await verifyAuth(req, 'OFFICER');
    if (isErrorResponse(auth)) return auth;
  }

  const supabase = createAdminClient();
  const botToken = process.env.DISCORD_BOT_TOKEN;
  const summary: Array<{ guild: string; warned: number; skipped: number; no_discord: number }> = [];

  // Check global flags
  const { data: pauseSetting } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'pause_discord_dms')
    .maybeSingle();
  const dmsPaused = pauseSetting?.value === 'true';

  const { data: pingsSetting } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'disable_guild_pings')
    .maybeSingle();
  const guildPingsDisabled = pingsSetting?.value === 'true';

  // Fetch guild configs — if called by officer, only their guild; cron fetches all
  let configQuery = supabase.from('guild_config').select('guild_id, guild_name, settings, donation_requirement');

  if (!isCron && guildIdHeader) {
    configQuery = configQuery.eq('guild_id', guildIdHeader);
  }

  const { data: configs } = await configQuery;

  // Fetch active status for all guilds in scope
  const configGuildIds = (configs ?? []).map((c) => c.guild_id);
  const { data: guildRows } = configGuildIds.length
    ? await supabase.from('guilds').select('id, is_active').in('id', configGuildIds)
    : { data: [] };
  const guildActiveMap = new Map((guildRows ?? []).map((g) => [g.id, g.is_active]));

  if (!configs || configs.length === 0) {
    return NextResponse.json({ message: 'No guilds with Discord log channel configured', summary });
  }

  // today = last completed game day (log_date of game day that just ended).
  // Game day boundary is 11:50 UTC; the just-completed day always has log_date = yesterday's calendar date.
  // Using yesterday is robust regardless of when the cron actually runs (delays of hours are common).
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));

  for (const config of configs) {
    const { guild_id: guildId, guild_name: guildName, settings, donation_requirement } = config;
    if (guildActiveMap.get(guildId) === false) continue;

    const logChannelId: string | null = settings?.discord_log_channel_id ?? null;
    const period: RequirementPeriod = settings?.requirement_period ?? 'daily';
    const weeklyReq: number = settings?.weekly_donation_requirement ?? 35000;
    const depositsOnly: boolean = settings?.deposits_only ?? false;
    const overflowEnabled: boolean = settings?.overflow_enabled ?? true;
    const overflowLimit: number = settings?.overflow_limit ?? 10000;
    const donationReq: number = settings?.donation_requirement ?? donation_requirement ?? 5000;

    let warned = 0;
    let skipped = 0;
    let noDiscord = 0;

    try {
      // Fetch active members (excluding leaders/deputies)
      const { data: members } = await supabase
        .from('members')
        .select('id, ign, position, discord_id, first_seen, hashed_id, character_id')
        .eq('current_guild_id', guildId)
        .eq('is_active', true)
        .not('position', 'in', '("LEADER","DEPUTY")');

      if (!members || members.length === 0) continue;

      const memberIds = members.map((m) => m.id);
      const memberSet = new Set(memberIds);

      // Fetch daily logs (last 90 days, up to and including inactivityAnchor = yesterday).
      // Upper bound prevents donations in the new game day from masking missed activity in the checked day.
      const since = new Date(today);
      since.setUTCDate(since.getUTCDate() - 90);
      const todayStr = today.toISOString().split('T')[0];
      const { data: logs } = await supabase
        .from('daily_logs')
        .select('member_id, log_date, met_requirement, deposits_gold, gold_donated, bank_balance_after')
        .in('member_id', memberIds)
        .gte('log_date', since.toISOString().split('T')[0])
        .lte('log_date', todayStr)
        .order('log_date', { ascending: false });

      // Compute current bank balance from logs (latest bank_balance_after drained to today).
      // More accurate than reading member_gold_bank which may lag by a day.
      const bankMap = new Map<string, number>();
      if (overflowEnabled) {
        const latestBankLog = new Map<string, { log_date: string; balance: number }>();
        for (const log of logs ?? []) {
          if (!latestBankLog.has(log.member_id)) {
            latestBankLog.set(log.member_id, { log_date: log.log_date, balance: log.bank_balance_after ?? 0 });
          }
        }
        for (const memberId of memberIds) {
          const latest = latestBankLog.get(memberId);
          if (!latest || latest.balance === 0) { bankMap.set(memberId, 0); continue; }
          const daysSince = Math.round(
            (new Date(todayStr + 'T00:00:00Z').getTime() - new Date(latest.log_date + 'T00:00:00Z').getTime()) / 86400000
          );
          let bal = latest.balance;
          for (let i = 0; i < daysSince && bal > 0; i++) bal = Math.max(0, bal - donationReq);
          bankMap.set(memberId, bal);
        }
      }

      // Fetch alt relationships — both directions to catch external-main pairs (mirrors overview logic)
      const [{ data: mainInGuildLinks }, { data: altInGuildLinks }] = await Promise.all([
        supabase.from('member_alts').select('member_id, alt_member_id')
          .in('member_id', memberIds).not('alt_member_id', 'is', null),
        supabase.from('member_alts').select('member_id, alt_member_id')
          .in('alt_member_id', memberIds).not('alt_member_id', 'is', null),
      ]);

      const altToMain = new Map<string, string>(); // alt_member_id → member_id
      const mainToAlts = new Map<string, string[]>(); // member_id → [alt_member_ids]

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
        if (memberSet.has(link.member_id)) continue; // already handled by mainInGuildLinks
        const arr = externalGroups.get(link.member_id) ?? [];
        arr.push(link.alt_member_id);
        externalGroups.set(link.member_id, arr);
      }
      for (const [, peerIds] of Array.from(externalGroups)) {
        if (peerIds.length < 2) continue;
        const sorted = [...peerIds].sort(
          (a, b) => (memberCharIdMap.get(a) ?? Infinity) - (memberCharIdMap.get(b) ?? Infinity)
        );
        const effectiveMain = sorted[0]!;
        for (const altId of sorted.slice(1)) {
          if (altToMain.has(altId)) continue;
          altToMain.set(altId, effectiveMain);
          const arr = mainToAlts.get(effectiveMain) ?? [];
          arr.push(altId);
          mainToAlts.set(effectiveMain, arr);
        }
      }

      // Build last-activity map per member
      const lastActivityMap = new Map<string, string>();
      // Hoisted so bank walk code can reuse it after lastActivityMap is built
      const weeklyMap = new Map<string, Map<string, number>>(); // member_id → week → total

      if (period === 'weekly') {
        // Group deposits_gold by member + ISO week
        for (const log of logs ?? []) {
          const weekKey = getISOWeekKey(log.log_date);
          const memberWeeks = weeklyMap.get(log.member_id) ?? new Map<string, number>();
          const goldVal = depositsOnly ? (log.deposits_gold ?? 0) : ((log.gold_donated ?? 0) + (log.deposits_gold ?? 0));
          memberWeeks.set(weekKey, (memberWeeks.get(weekKey) ?? 0) + goldVal);
          weeklyMap.set(log.member_id, memberWeeks);
        }

        Array.from(weeklyMap.entries()).forEach(([memberId, weeks]) => {
          const lastMetSunday = findLastMetWeek(Object.fromEntries(Array.from(weeks.entries())), weeklyReq);
          if (lastMetSunday) {
            lastActivityMap.set(memberId, lastMetSunday.toISOString().split('T')[0]);
          }
        });
      } else {
        for (const log of logs ?? []) {
          if (log.met_requirement && !lastActivityMap.has(log.member_id)) {
            lastActivityMap.set(log.member_id, log.log_date);
          }
        }
      }

      // Build log maps for bank simulations (individual + shared)
      const bankByDate = new Map<string, Map<string, { balance: number; met: boolean }>>();
      const rawLogsForGroup = new Map<string, Map<string, { gold: number; deposits: number; met: boolean }>>();
      if (overflowEnabled) {
        for (const log of logs ?? []) {
          const mb = bankByDate.get(log.member_id) ?? new Map<string, { balance: number; met: boolean }>();
          mb.set(log.log_date, { balance: log.bank_balance_after ?? 0, met: log.met_requirement ?? false });
          bankByDate.set(log.member_id, mb);
          const mr = rawLogsForGroup.get(log.member_id) ?? new Map<string, { gold: number; deposits: number; met: boolean }>();
          mr.set(log.log_date, { gold: log.gold_donated ?? 0, deposits: log.deposits_gold ?? 0, met: log.met_requirement ?? false });
          rawLogsForGroup.set(log.member_id, mr);
        }
      }

      // Individual bank walk: inactive periods covered by personal bank count as met.
      if (overflowEnabled) {
        if (period === 'daily') {
          for (const member of members) {
            const memberId = member.id;
            const lastDate = lastActivityMap.get(memberId);
            if (!lastDate) continue;

            const memberDays = bankByDate.get(memberId) ?? new Map<string, { balance: number; met: boolean }>();
            let balance = memberDays.get(lastDate)?.balance ?? 0;
            if (balance === 0) continue;

            const startMs = new Date(lastDate + 'T00:00:00Z').getTime() + 86400000;
            const endMs = today.getTime();

            for (let ms = startMs; ms <= endMs && balance > 0; ms += 86400000) {
              const dateStr = new Date(ms).toISOString().split('T')[0];
              const dayEntry = memberDays.get(dateStr);
              if (dayEntry) {
                balance = dayEntry.balance;
              } else if (balance >= donationReq) {
                const existing = lastActivityMap.get(memberId);
                if (!existing || dateStr > existing) lastActivityMap.set(memberId, dateStr);
                balance = balance - donationReq;
              } else {
                balance = 0;
              }
            }
          }
        } else {
          // Weekly: simulate bank from weekly totals and walk weeks after last met week
          const currentWeekKey = getISOWeekKey(todayStr);
          for (const member of members) {
            const memberId = member.id;
            const memberWeeks = weeklyMap.get(memberId);
            if (!memberWeeks || memberWeeks.size === 0) continue;

            const sortedWeeks = Array.from(memberWeeks.keys()).sort();
            const firstWeek = sortedWeeks[0]!;
            const lastLogWeek = sortedWeeks[sortedWeeks.length - 1]!;
            const allHistoryWeeks = getWeekKeyRange(firstWeek, currentWeekKey);

            // Simulate running balance through all historical weeks
            let balance = 0;
            for (const wk of allHistoryWeeks) {
              const total = memberWeeks.get(wk) ?? 0;
              if (total >= weeklyReq) {
                balance = Math.min(balance + (total - weeklyReq), overflowLimit);
              } else {
                balance = Math.max(0, balance - (weeklyReq - total));
              }
            }
            if (balance <= 0) continue;

            // Walk weeks from lastLogWeek onward covering shortfalls
            const futureWeeks = getWeekKeyRange(lastLogWeek, currentWeekKey).slice(1);
            for (const wk of futureWeeks) {
              const weekTotal = memberWeeks.get(wk) ?? 0;
              const deficit = weeklyReq - weekTotal;
              const bankUsed = Math.min(deficit, balance);
              if (weekTotal + bankUsed >= weeklyReq) {
                balance = Math.max(0, balance - bankUsed);
                const sunday = getWeekSunday(wk);
                const existing = lastActivityMap.get(memberId);
                if (!existing || sunday > existing) lastActivityMap.set(memberId, sunday);
              } else {
                break;
              }
            }
          }
        }
      }

      // Snapshot before shared bank walk — used to detect who gets covered by shared bank
      const preSharedBankMap = new Map(lastActivityMap);

      // Shared bank walk: linked alts pool their bank. Most-inactive alt covered first.
      if (overflowEnabled) {
        const processedGroups = new Set<string>();
        for (const member of members) {
          if (processedGroups.has(member.id)) continue;
          const altIds = (mainToAlts.get(member.id) ?? []).filter(aid => memberSet.has(aid));
          if (altIds.length === 0) { processedGroups.add(member.id); continue; }

          const groupIds = [member.id, ...altIds];
          groupIds.forEach(id => processedGroups.add(id));

          const combinedLimit = overflowLimit * groupIds.length;

          if (period === 'daily') {
            // Walk start = earliest lastActivityMap date in the group
            const groupLastDates = groupIds.map(id => lastActivityMap.get(id)).filter(Boolean) as string[];
            if (groupLastDates.length === 0) continue;
            const walkStart = groupLastDates.reduce((a, b) => (a < b ? a : b));

            // Starting shared bank = sum of each member's bank_balance_after at walkStart
            let sharedBank = 0;
            for (const id of groupIds) {
              const memberLogs = bankByDate.get(id);
              if (!memberLogs) continue;
              let latestBefore: string | null = null;
              for (const [date] of Array.from(memberLogs.entries())) {
                if (date <= walkStart && (latestBefore === null || date > latestBefore)) latestBefore = date;
              }
              if (latestBefore) {
                let bal = memberLogs.get(latestBefore)!.balance;
                const gapDays = Math.round(
                  (new Date(walkStart + 'T00:00:00Z').getTime() - new Date(latestBefore + 'T00:00:00Z').getTime()) / 86400000
                );
                for (let i = 0; i < gapDays && bal > 0; i++) bal = Math.max(0, bal - donationReq);
                sharedBank += Math.min(bal, overflowLimit);
              }
            }
            sharedBank = Math.min(sharedBank, combinedLimit);

            const walkStartMs = new Date(walkStart + 'T00:00:00Z').getTime() + 86400000;
            const endMs = today.getTime();

            for (let ms = walkStartMs; ms <= endMs; ms += 86400000) {
              const dateStr = new Date(ms).toISOString().split('T')[0];
              let dayExcess = 0;
              const shortfalls: Array<{ id: string; amount: number }> = [];

              for (const id of groupIds) {
                const alreadyCovered = (lastActivityMap.get(id) ?? '') >= dateStr;
                const entry = rawLogsForGroup.get(id)?.get(dateStr);
                const raw = entry ? (depositsOnly ? entry.deposits : (entry.gold + entry.deposits)) : 0;
                if (raw >= donationReq) {
                  dayExcess += raw - donationReq;
                } else if (!alreadyCovered) {
                  shortfalls.push({ id, amount: donationReq - raw });
                }
              }

              sharedBank = Math.min(sharedBank + dayExcess, combinedLimit);
              shortfalls.sort((a, b) => {
                const la = lastActivityMap.get(a.id) ?? '';
                const lb = lastActivityMap.get(b.id) ?? '';
                return la < lb ? -1 : la > lb ? 1 : 0;
              });
              for (const { id, amount } of shortfalls) {
                if (sharedBank >= amount) {
                  sharedBank -= amount;
                  const existing = lastActivityMap.get(id);
                  if (!existing || dateStr > existing) lastActivityMap.set(id, dateStr);
                }
              }
            }
          } else {
            // Weekly shared bank walk
            const allGroupWeekKeys = new Set<string>();
            for (const id of groupIds) {
              const mw = weeklyMap.get(id);
              if (mw) Array.from(mw.keys()).forEach(wk => allGroupWeekKeys.add(wk));
            }
            if (allGroupWeekKeys.size === 0) continue;

            const currentWeekKey = getISOWeekKey(todayStr);
            const sortedGroupWeeks = Array.from(allGroupWeekKeys).sort();
            const allWeeks = getWeekKeyRange(sortedGroupWeeks[0]!, currentWeekKey);

            let sharedBank = 0;

            for (const wk of allWeeks) {
              let weekExcess = 0;
              const shortfalls: Array<{ id: string; amount: number }> = [];

              for (const id of groupIds) {
                const lastDateForId = lastActivityMap.get(id) ?? '';
                const lastWeekForId = lastDateForId ? getISOWeekKey(lastDateForId) : '';
                const alreadyCovered = lastWeekForId >= wk;
                const weekTotal = weeklyMap.get(id)?.get(wk) ?? 0;

                if (weekTotal >= weeklyReq) {
                  weekExcess += weekTotal - weeklyReq;
                } else if (!alreadyCovered) {
                  shortfalls.push({ id, amount: weeklyReq - weekTotal });
                }
              }

              sharedBank = Math.min(sharedBank + weekExcess, combinedLimit);
              shortfalls.sort((a, b) => {
                const la = lastActivityMap.get(a.id) ?? '';
                const lb = lastActivityMap.get(b.id) ?? '';
                return la < lb ? -1 : la > lb ? 1 : 0;
              });
              for (const { id, amount } of shortfalls) {
                if (sharedBank >= amount) {
                  sharedBank -= amount;
                  const sunday = getWeekSunday(wk);
                  const existing = lastActivityMap.get(id);
                  if (!existing || sunday > existing) lastActivityMap.set(id, sunday);
                }
              }
            }
          }
        }
      }

      // Fetch warnings from last 24h only — prevent same-run duplicates, allow daily escalation
      const recentSince = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const { data: recentWarnings } = await supabase
        .from('warnings')
        .select('member_id, warning_level, created_at')
        .eq('guild_id', guildId)
        .in('member_id', memberIds)
        .gte('created_at', recentSince.toISOString());

      // Set of "member_id:level" warned in last 24h — skip exact duplicates only
      const recentlyWarnedSet = new Set<string>();
      const levelOrder = { warn1: 1, warn2: 2, kick: 3 };
      for (const w of recentWarnings ?? []) {
        recentlyWarnedSet.add(`${w.member_id}:${w.warning_level}`);
      }

      // Collect all inactive members for the full inactivity report
      const inactiveReport: Array<{ ign: string; daysInactive: number; warning_level: string; discord_id: string | null }> = [];
      const sharedBankCovered: Array<{ ign: string }> = [];

      for (const member of members) {
        const lastDate = lastActivityMap.get(member.id);

        let daysSinceJoin = 999;
        if (member.first_seen) {
          daysSinceJoin = Math.max(0, Math.floor((today.getTime() - new Date(member.first_seen).getTime()) / 86400000));
        }

        let daysInactive: number;
        if (!lastDate) {
          daysInactive = Math.min(daysSinceJoin, 999);
        } else {
          daysInactive = Math.max(0, Math.floor((today.getTime() - new Date(lastDate + 'T00:00:00Z').getTime()) / 86400000));
          daysInactive = Math.min(daysInactive, daysSinceJoin);
        }

        const { warning_level } = getWarningInfo(daysInactive, period);
        if (warning_level === 'safe') {
          // Check if they were inactive before shared bank coverage was applied
          const ignLower = member.ign?.toLowerCase() ?? '';
          if (member.ign && !ignLower.includes('raw activity') && !ignLower.includes('log')) {
            const ADMIN_HASHED_IDS = new Set(['6aDoyRnLyEey9LpV5AGX', 'AB1E9poQq7VOKYnakeJj', 'o31P7kZL6Z31BLveGxXO']);
            if (!member.hashed_id || !ADMIN_HASHED_IDS.has(member.hashed_id)) {
              const preLastDate = preSharedBankMap.get(member.id);
              let preDaysInactive: number;
              if (!preLastDate) {
                preDaysInactive = Math.min(daysSinceJoin, 999);
              } else {
                preDaysInactive = Math.max(0, Math.floor((today.getTime() - new Date(preLastDate + 'T00:00:00Z').getTime()) / 86400000));
                preDaysInactive = Math.min(preDaysInactive, daysSinceJoin);
              }
              const { warning_level: preLevel } = getWarningInfo(preDaysInactive, period);
              if (preLevel !== 'safe') {
                sharedBankCovered.push({ ign: member.ign });
              }
            }
          }
          continue;
        }

        // Filter junk accounts (same as reports page)
        const ignLower = member.ign?.toLowerCase() ?? '';
        if (!member.ign || ignLower.includes('raw activity') || ignLower.includes('log')) continue;

        // Exempt admin accounts
        const ADMIN_HASHED_IDS = new Set(['6aDoyRnLyEey9LpV5AGX', 'AB1E9poQq7VOKYnakeJj', 'o31P7kZL6Z31BLveGxXO']);
        if (member.hashed_id && ADMIN_HASHED_IDS.has(member.hashed_id)) continue;

        // Use effective days (grace-adjusted) for display
        const effectiveDays = getEffectiveDaysInactive(daysInactive, period);

        // Add to full inactivity report (all inactive, regardless of warn status)
        inactiveReport.push({ ign: member.ign, daysInactive: effectiveDays, warning_level, discord_id: member.discord_id ?? null });

        // Skip only if warned at this exact level in last 24h (prevent duplicates, allow escalation)
        if (recentlyWarnedSet.has(`${member.id}:${warning_level}`)) {
          skipped++;
          continue;
        }

        // Send DM if Discord ID is mapped and bot token exists (skip if DMs are paused)
        let dmSent = false;
        let dmError: string | null = null;
        const levelLabel = warning_level === 'warn1' ? '⚠️ Warning' : warning_level === 'warn2' ? '⚠️⚠️ Final Warning' : '🚫 Kick Notice';

        const linkedAltIds = (mainToAlts.get(member.id) ?? []).filter(aid => memberSet.has(aid));
        const groupMemberIds = [member.id, ...linkedAltIds];
        const combinedBankBalance = groupMemberIds.reduce((s, id) => s + (bankMap.get(id) ?? 0), 0);
        const combinedBankLimit = overflowLimit * groupMemberIds.length;
        const bankLine = overflowEnabled
          ? `\n💰 Bank balance: **${combinedBankBalance.toLocaleString()}** / ${combinedBankLimit.toLocaleString()} gold${combinedBankBalance >= combinedBankLimit ? ' ✅ (capped)' : ''}`
          : '';

        if (dmsPaused) {
          dmError = 'DMs paused (admin setting)';
          noDiscord++;
        } else if (member.discord_id && botToken) {
          const dmMsg = period === 'weekly'
            ? `${levelLabel}\nYour character **${member.ign}** in **${guildName}** has been flagged for inactivity (${effectiveDays} effective days inactive, weekly req: **${weeklyReq.toLocaleString()}g**).\nPlease ensure you meet the weekly donation requirement to remain in the guild.${bankLine}\n📅 Weekly requirement resets each Monday at 11:50 UTC. Bank balance covers missed weeks automatically.`
            : `${levelLabel}\nYour character **${member.ign}** in **${guildName}** has been flagged for inactivity (${effectiveDays} days inactive).\nPlease ensure you meet the activity requirements to remain in the guild.${bankLine}\n📅 Each game day runs **11:50 UTC to 11:49 UTC** the following day. The daily check runs shortly after — donations made after **11:50 UTC today** count toward tomorrow's check, not today's.`;
          const result = await sendDirectMessage(member.discord_id, dmMsg);
          dmSent = result.ok;
          dmError = result.error ?? null;
          warned++;
        } else {
          noDiscord++;
        }

        // Log warning regardless of DM success
        await supabase.from('warnings').insert({
          member_id: member.id,
          guild_id: guildId,
          warning_level,
          reason: `Auto-warn: ${effectiveDays}d inactive`,
          is_auto: true,
          discord_dm_sent: dmSent,
          discord_dm_error: dmError,
        });

        // Post per-member DM confirmation to warn log channel
        const warnLogChannelId = process.env.DISCORD_WARN_LOG_CHANNEL_ID;
        if (warnLogChannelId && botToken) {
          const dmStatus = dmsPaused
            ? '⏸️ DM paused'
            : member.discord_id
              ? (dmSent ? '✅ DM sent' : `❌ DM failed: ${dmError ?? 'unknown'}`)
              : '❌ No Discord ID';
          const logLine = `${levelLabel} **${member.ign}** · Guild: **${guildName}** · ${daysInactive} days inactive · ${dmStatus}`;
          const channelResult = await postToChannel(warnLogChannelId, logLine);
          if (!channelResult.ok) {
            console.error(`[auto-warn] Warn log post failed for ${member.ign}:`, channelResult.error);
          }
          await new Promise(r => setTimeout(r, 500));
        }
      }

      // Post full inactivity report to guild log channel
      if (logChannelId && botToken) {
        const kickList = inactiveReport.filter((m) => m.warning_level === 'kick').sort((a, b) => b.daysInactive - a.daysInactive);
        const warn2List = inactiveReport.filter((m) => m.warning_level === 'warn2').sort((a, b) => b.daysInactive - a.daysInactive);
        const warn1List = inactiveReport.filter((m) => m.warning_level === 'warn1').sort((a, b) => b.daysInactive - a.daysInactive);

        const lines: string[] = [];
        const fmtMember = (m: { ign: string; daysInactive: number; discord_id: string | null }) =>
          `• **${m.ign}**${!guildPingsDisabled && m.discord_id ? ` (<@${m.discord_id}>)` : ''} — ${m.daysInactive}d inactive`;

        const reqLabel = period === 'weekly'
          ? `Weekly req: **${weeklyReq.toLocaleString()}g** · Daily req: ${donationReq.toLocaleString()}g`
          : `Daily req: **${donationReq.toLocaleString()}g**`;

        let headerLine: string;
        let warningLine: string;
        if (period === 'weekly') {
          const checkedWeek = getISOWeekKey(today.toISOString().split('T')[0]);
          headerLine = `**${guildName} — Inactivity Report** · Checked week: **${checkedWeek}** · ${reqLabel}`;
          warningLine = `⚠️ Weekly req resets each **Monday 11:50 UTC**. Bank covers missed weeks automatically.`;
        } else {
          const gameDay = today.toISOString().split('T')[0];
          headerLine = `**${guildName} — Inactivity Report** · Checked game day: **${gameDay}** (11:50 UTC → next day 11:49 UTC) · ${reqLabel}`;
          warningLine = `⚠️ Donations after **11:50 UTC today** count toward **tomorrow's** check, not this one.`;
        }

        if (inactiveReport.length === 0 && sharedBankCovered.length === 0) {
          lines.push(`${headerLine}\n✅ **All members active — no warnings issued!**`);
        } else {
          lines.push(`${headerLine}\n${warningLine}`);

          if (kickList.length) {
            lines.push(`\n🚫 **Kick Notice** (${kickList.length})`);
            kickList.forEach((m) => lines.push(fmtMember(m)));
          }
          if (warn2List.length) {
            lines.push(`\n⚠️⚠️ **Final Warning** (${warn2List.length})`);
            warn2List.forEach((m) => lines.push(fmtMember(m)));
          }
          if (warn1List.length) {
            lines.push(`\n⚠️ **Warning** (${warn1List.length})`);
            warn1List.forEach((m) => lines.push(fmtMember(m)));
          }
          if (sharedBankCovered.length) {
            lines.push(`\n🏦 **Bank Covered** (${sharedBankCovered.length}) — inactivity covered by shared alt bank`);
            sharedBankCovered.forEach((m) => {
              lines.push(`• **${m.ign}**`);
            });
          }
        }

        // Bank balance section — all active members with non-zero balance (no pings ever)
        if (overflowEnabled) {
          const bankEntries = members
            .map((m) => ({ ign: m.ign, balance: bankMap.get(m.id) ?? 0 }))
            .filter((m) => m.balance > 0)
            .sort((a, b) => b.balance - a.balance);

          if (bankEntries.length > 0) {
            lines.push(`\n────────────────────`);
            lines.push(`💰 **Bank Balances** (cap: ${overflowLimit.toLocaleString()} gold)`);
            bankEntries.forEach((m) => {
              const capped = m.balance >= overflowLimit;
              lines.push(`• **${m.ign}** — ${m.balance.toLocaleString()} gold${capped ? ' ✅' : ''}`);
            });
          }
        }

        // Chunk into messages under 2000 chars, with delay between posts to avoid rate limiting
        let chunk = '';
        for (const line of lines) {
          if ((chunk + '\n' + line).length > 1900) {
            await postToChannel(logChannelId, chunk.trim());
            await new Promise(r => setTimeout(r, 500));
            chunk = line;
          } else {
            chunk = chunk ? chunk + '\n' + line : line;
          }
        }
        if (chunk) await postToChannel(logChannelId, chunk.trim());
      }

      summary.push({ guild: guildName, warned, skipped, no_discord: noDiscord });
    } catch (err) {
      console.error(`[auto-warn] Error for guild ${guildId}:`, err);
      summary.push({ guild: guildName ?? guildId, warned, skipped, no_discord: noDiscord });
    }
  }

  return NextResponse.json({ ok: true, summary });
}
