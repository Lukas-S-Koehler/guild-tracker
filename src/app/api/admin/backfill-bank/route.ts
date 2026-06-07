import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { verifySuperAdmin, isErrorResponse } from '@/lib/auth-helpers';

// POST /api/admin/backfill-bank
// Replays all historical daily_logs in chronological order and recomputes
// bank_earned, bank_used, bank_balance_after, met_requirement for every member.
// Must be run once after deploying the overflow bank feature.
export async function POST(req: NextRequest) {
  const auth = await verifySuperAdmin(req);
  if (isErrorResponse(auth)) return auth;

  const body = await req.json().catch(() => ({}));
  const { guild_id: targetGuildId } = body as { guild_id?: string };

  const supabase = createAdminClient();

  // Fetch guild configs (one guild or all)
  let configQuery = supabase
    .from('guild_config')
    .select('guild_id, guild_name, donation_requirement, settings');
  if (targetGuildId) {
    configQuery = configQuery.eq('guild_id', targetGuildId);
  }
  const { data: configs } = await configQuery;

  if (!configs || configs.length === 0) {
    return NextResponse.json({ error: 'No guilds found' }, { status: 404 });
  }

  const results: Array<{ guild: string; members: number; logsUpdated: number }> = [];

  for (const config of configs) {
    const { guild_id: guildId, guild_name: guildName, settings } = config;
    const donationReq: number = settings?.donation_requirement ?? config.donation_requirement ?? 5000;
    const overflowEnabled: boolean = settings?.overflow_enabled ?? true;
    const overflowLimit: number = settings?.overflow_limit ?? 10000;

    // Fetch all active members in this guild
    const { data: members } = await supabase
      .from('members')
      .select('id')
      .eq('current_guild_id', guildId)
      .eq('is_active', true);

    if (!members || members.length === 0) continue;

    let totalLogsUpdated = 0;

    for (const member of members) {
      // Fetch all daily_logs for this member in this guild, oldest first
      const { data: logs } = await supabase
        .from('daily_logs')
        .select('id, log_date, gold_donated, deposits_gold, met_requirement, bank_used, bank_earned, bank_balance_after')
        .eq('member_id', member.id)
        .eq('guild_id', guildId)
        .order('log_date', { ascending: true });

      if (!logs || logs.length === 0) continue;

      let runningBalance = 0;
      let prevLogDate: string | null = null;

      for (const log of logs) {
        // Drain bank for each skipped day between previous log and this one
        if (runningBalance > 0 && prevLogDate) {
          const skippedDays =
            Math.round((new Date(log.log_date + 'T00:00:00Z').getTime() - new Date(prevLogDate + 'T00:00:00Z').getTime()) / 86400000) - 1;
          for (let i = 0; i < skippedDays && runningBalance > 0; i++) {
            runningBalance = Math.max(0, runningBalance - donationReq);
          }
        }

        const gross = (log.gold_donated ?? 0) + (log.deposits_gold ?? 0);

        let newBankEarned = 0;
        let newBankUsed = 0;
        let metRequirement: boolean;

        if (overflowEnabled) {
          if (gross >= donationReq) {
            newBankEarned = Math.min(gross - donationReq, overflowLimit - runningBalance);
            metRequirement = true;
          } else {
            const deficit = donationReq - gross;
            newBankUsed = Math.min(deficit, runningBalance);
            metRequirement = gross + newBankUsed >= donationReq;
          }
        } else {
          metRequirement = gross >= donationReq;
        }

        const bankBalanceAfter = Math.min(
          Math.max(runningBalance + newBankEarned - newBankUsed, 0),
          overflowLimit
        );

        // Only update if something changed
        if (
          log.bank_earned !== newBankEarned ||
          log.bank_used !== newBankUsed ||
          log.bank_balance_after !== bankBalanceAfter ||
          log.met_requirement !== metRequirement
        ) {
          await supabase
            .from('daily_logs')
            .update({
              bank_earned: newBankEarned,
              bank_used: newBankUsed,
              bank_balance_after: bankBalanceAfter,
              met_requirement: metRequirement,
            })
            .eq('id', log.id);
          totalLogsUpdated++;
        }

        runningBalance = bankBalanceAfter;
        prevLogDate = log.log_date;
      }

      // Drain for days between the last log and yesterday (last completed game day).
      // Members with no recent activity still owe daily requirements against their bank.
      if (runningBalance > 0 && prevLogDate) {
        const yesterday = new Date();
        yesterday.setUTCDate(yesterday.getUTCDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];
        const daysToYesterday = Math.round(
          (new Date(yesterdayStr + 'T00:00:00Z').getTime() - new Date(prevLogDate + 'T00:00:00Z').getTime()) / 86400000
        );
        for (let i = 0; i < daysToYesterday && runningBalance > 0; i++) {
          runningBalance = Math.max(0, runningBalance - donationReq);
        }
      }

      // Update member_gold_bank with the fully-drained current balance
      await supabase
        .from('member_gold_bank')
        .upsert(
          { member_id: member.id, guild_id: guildId, balance: runningBalance, updated_at: new Date().toISOString() },
          { onConflict: 'member_id,guild_id' }
        );
    }

    results.push({ guild: guildName, members: members.length, logsUpdated: totalLogsUpdated });
  }

  return NextResponse.json({ ok: true, results });
}
