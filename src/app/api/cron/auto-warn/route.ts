import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { verifyAuth, isErrorResponse } from '@/lib/auth-helpers';
import { sendDirectMessage, postToChannel } from '@/lib/discord-api';
import { getWarningInfo, findLastMetWeek, getISOWeekKey, RequirementPeriod } from '@/lib/warning-calculator';

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

  // Fetch guild configs — if called by officer, only their guild; cron fetches all
  let configQuery = supabase.from('guild_config').select('guild_id, guild_name, settings');

  if (!isCron && guildIdHeader) {
    configQuery = configQuery.eq('guild_id', guildIdHeader);
  }

  const { data: configs } = await configQuery;

  if (!configs || configs.length === 0) {
    return NextResponse.json({ message: 'No guilds with Discord log channel configured', summary });
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  for (const config of configs) {
    const { guild_id: guildId, guild_name: guildName, settings } = config;
    const logChannelId: string | null = settings?.discord_log_channel_id ?? null;
    const period: RequirementPeriod = settings?.requirement_period ?? 'daily';
    const weeklyReq: number = settings?.weekly_donation_requirement ?? 35000;
    const depositsOnly: boolean = settings?.deposits_only ?? false;

    let warned = 0;
    let skipped = 0;
    let noDiscord = 0;

    try {
      // Fetch active members (excluding leaders/deputies)
      const { data: members } = await supabase
        .from('members')
        .select('id, ign, position, discord_id, first_seen')
        .eq('current_guild_id', guildId)
        .eq('is_active', true)
        .not('position', 'in', '("LEADER","DEPUTY")');

      if (!members || members.length === 0) continue;

      const memberIds = members.map((m) => m.id);

      // Fetch daily logs (last 90 days covers weekly calc too)
      const since = new Date(today);
      since.setUTCDate(since.getUTCDate() - 90);
      const { data: logs } = await supabase
        .from('daily_logs')
        .select('member_id, log_date, met_requirement, deposits_gold')
        .in('member_id', memberIds)
        .gte('log_date', since.toISOString().split('T')[0])
        .order('log_date', { ascending: false });

      // Fetch alt relationships for same-guild coverage
      const { data: altLinks } = await supabase
        .from('member_alts')
        .select('member_id, alt_member_id')
        .in('member_id', memberIds)
        .not('alt_member_id', 'is', null);

      const altToMain = new Map<string, string>(); // alt_member_id → member_id
      const mainToAlts = new Map<string, string[]>(); // member_id → [alt_member_ids]
      for (const link of altLinks ?? []) {
        if (!link.alt_member_id) continue;
        altToMain.set(link.alt_member_id, link.member_id);
        const arr = mainToAlts.get(link.member_id) ?? [];
        arr.push(link.alt_member_id);
        mainToAlts.set(link.member_id, arr);
      }

      // Build last-activity map per member
      const lastActivityMap = new Map<string, string>();

      if (period === 'weekly') {
        // Group deposits_gold by member + ISO week
        const weeklyMap = new Map<string, Map<string, number>>(); // member_id → week → total
        for (const log of logs ?? []) {
          const weekKey = getISOWeekKey(log.log_date);
          const memberWeeks = weeklyMap.get(log.member_id) ?? new Map<string, number>();
          memberWeeks.set(weekKey, (memberWeeks.get(weekKey) ?? 0) + (log.deposits_gold ?? 0));
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
          const goldField = depositsOnly ? (log.deposits_gold ?? 0) : null;
          const counts = depositsOnly ? goldField !== null : log.met_requirement;
          if (counts && !lastActivityMap.has(log.member_id)) {
            lastActivityMap.set(log.member_id, log.log_date);
          }
        }
      }

      // Fetch recent warnings to avoid duplicate warns
      const recentSince = new Date(today);
      recentSince.setUTCDate(recentSince.getUTCDate() - 7);
      const { data: recentWarnings } = await supabase
        .from('warnings')
        .select('member_id, warning_level, created_at')
        .eq('guild_id', guildId)
        .in('member_id', memberIds)
        .gte('created_at', recentSince.toISOString());

      // Map: member_id → highest warning_level warned in last 7 days
      const recentlyWarnedLevel = new Map<string, string>();
      const levelOrder = { warn1: 1, warn2: 2, kick: 3 };
      for (const w of recentWarnings ?? []) {
        const current = recentlyWarnedLevel.get(w.member_id);
        if (!current || levelOrder[w.warning_level as keyof typeof levelOrder] > levelOrder[current as keyof typeof levelOrder]) {
          recentlyWarnedLevel.set(w.member_id, w.warning_level);
        }
      }

      const memberSet = new Set(memberIds);

      for (const member of members) {
        let lastDate = lastActivityMap.get(member.id);

        // Check if an alt in the same guild covers this member
        const altIds = mainToAlts.get(member.id) ?? [];
        const altInGuild = altIds.filter((aid) => memberSet.has(aid));
        for (const altId of altInGuild) {
          const altLast = lastActivityMap.get(altId);
          if (altLast && (!lastDate || altLast > lastDate)) {
            lastDate = altLast;
          }
        }
        // Also check if this member is an alt of someone else in the guild
        const mainId = altToMain.get(member.id);
        if (mainId && memberSet.has(mainId)) {
          const mainLast = lastActivityMap.get(mainId);
          if (mainLast && (!lastDate || mainLast > lastDate)) {
            lastDate = mainLast;
          }
        }

        let daysSinceJoin = 999;
        if (member.first_seen) {
          daysSinceJoin = Math.floor((today.getTime() - new Date(member.first_seen).getTime()) / 86400000);
        }

        let daysInactive: number;
        if (!lastDate) {
          daysInactive = Math.min(daysSinceJoin, 999);
        } else {
          daysInactive = Math.floor((today.getTime() - new Date(lastDate + 'T00:00:00Z').getTime()) / 86400000);
          daysInactive = Math.min(daysInactive, daysSinceJoin);
        }

        const { warning_level } = getWarningInfo(daysInactive, period);
        if (warning_level === 'safe') continue;

        // Check if already warned at this level or higher in last 7 days
        const alreadyWarnedLevel = recentlyWarnedLevel.get(member.id);
        if (alreadyWarnedLevel) {
          const alreadyOrder = levelOrder[alreadyWarnedLevel as keyof typeof levelOrder] ?? 0;
          const currentOrder = levelOrder[warning_level as keyof typeof levelOrder] ?? 0;
          if (alreadyOrder >= currentOrder) {
            skipped++;
            continue;
          }
        }

        // Send DM if Discord ID is mapped and bot token exists
        let dmSent = false;
        let dmError: string | null = null;

        if (member.discord_id && botToken) {
          const levelLabel = warning_level === 'warn1' ? '⚠️ Warning' : warning_level === 'warn2' ? '⚠️⚠️ Final Warning' : '🚫 Kick Notice';
          const dmMsg = `${levelLabel}\nYou have received an automated warning in **${guildName}** for inactivity (${daysInactive} days inactive).\nPlease ensure you meet the activity requirements to remain in the guild.`;
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
          reason: `Auto-warn: ${daysInactive} days inactive`,
          is_auto: true,
          discord_dm_sent: dmSent,
          discord_dm_error: dmError,
        });
      }

      // Post summary to Discord log channel
      if (logChannelId && botToken && (warned > 0 || noDiscord > 0)) {
        const summaryMsg = `**${guildName} — Auto-Warn Complete**\n✉️ DMs sent: ${warned}\n⚠️ No Discord ID: ${noDiscord}\n⏭️ Already warned: ${skipped}`;
        await postToChannel(logChannelId, summaryMsg);
      }

      summary.push({ guild: guildName, warned, skipped, no_discord: noDiscord });
    } catch (err) {
      console.error(`[auto-warn] Error for guild ${guildId}:`, err);
      summary.push({ guild: guildName ?? guildId, warned, skipped, no_discord: noDiscord });
    }
  }

  return NextResponse.json({ ok: true, summary });
}
