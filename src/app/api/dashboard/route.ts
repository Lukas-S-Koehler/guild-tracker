import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { getLastCompletedDay } from '@/lib/utils';

// GET /api/dashboard
// Universal dashboard data across all guilds. Public — no auth required.
export async function GET(req: NextRequest) {
  const admin = createAdminClient();
  const today = getLastCompletedDay();

  const [todayLogsRes, allTimeRes, guildsRes] = await Promise.all([
    admin
      .from('daily_logs')
      .select(`
        id,
        log_date,
        raids,
        gold_donated,
        deposits_gold,
        met_requirement,
        guild_id,
        members (id, ign)
      `)
      .eq('log_date', today)
      .order('met_requirement', { ascending: false }),

    admin
      .from('daily_logs')
      .select('raids, gold_donated, deposits_gold, guild_id'),

    admin.from('guilds').select('id, name, nickname'),
  ]);

  const todayLogs = todayLogsRes.data || [];
  const allLogs = allTimeRes.data || [];
  const guilds = guildsRes.data || [];

  const guildMap: Record<string, string> = {};
  for (const g of guilds) {
    guildMap[g.id] = g.nickname || g.name;
  }

  // All-time totals
  const totalRaids = allLogs.reduce((s: number, l: any) => s + (l.raids || 0), 0);
  const totalGold = allLogs.reduce((s: number, l: any) => s + (l.gold_donated || 0) + (l.deposits_gold || 0), 0);

  // Active member count = distinct members in all_logs (unique member entries ever)
  const activeMembers = await admin
    .from('members')
    .select('id', { count: 'exact', head: true })
    .eq('is_active', true);

  return NextResponse.json({
    date: today,
    today: todayLogs.map((l: any) => ({
      id: l.id,
      ign: l.members?.ign ?? '?',
      met_requirement: l.met_requirement,
      raids: l.raids || 0,
      gold: (l.gold_donated || 0) + (l.deposits_gold || 0),
      guild_name: guildMap[l.guild_id] ?? l.guild_id,
    })),
    stats: {
      totalRaids,
      totalGold,
      totalActiveMembers: activeMembers.count ?? 0,
      totalGuilds: guilds.length,
    },
  });
}
