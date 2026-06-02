import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { verifyAuth, isErrorResponse } from '@/lib/auth-helpers';
import { formatInactivityReport, getLastCompletedDay } from '@/lib/utils';

export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req, 'OFFICER');
  if (isErrorResponse(auth)) return auth;

  const supabase = createServerClient(req);

  const { data: config } = await supabase
    .from('guild_config')
    .select('guild_name, settings')
    .eq('guild_id', auth.guildId)
    .single();

  const webhookUrl = config?.settings?.discord_webhook_url;
  if (!webhookUrl) {
    return NextResponse.json({ error: 'No Discord webhook configured for this guild' }, { status: 400 });
  }

  const { data: members } = await supabase
    .from('members')
    .select('id, ign, position, first_seen')
    .eq('current_guild_id', auth.guildId)
    .eq('is_active', true);

  if (!members || members.length === 0) {
    return NextResponse.json({ error: 'No members found' }, { status: 404 });
  }

  const { data: recentLogs } = await supabase
    .from('daily_logs')
    .select('member_id, log_date')
    .eq('guild_id', auth.guildId)
    .eq('met_requirement', true)
    .in('member_id', members.map((m) => m.id))
    .order('log_date', { ascending: false })
    .limit(365);

  const lastActivityMap = new Map<string, string>();
  recentLogs?.forEach((log) => {
    if (!lastActivityMap.has(log.member_id)) {
      lastActivityMap.set(log.member_id, log.log_date);
    }
  });

  const today = new Date(getLastCompletedDay() + 'T00:00:00Z');

  const getCategory = (daysInactive: number): string => {
    if (daysInactive === 0) return 'active';
    if (daysInactive === 1) return '1d';
    if (daysInactive === 2) return '2d';
    if (daysInactive === 3) return '3d';
    return '4d+';
  };

  const inactiveMembers = members
    .filter((m) => m.position !== 'LEADER' && m.position !== 'DEPUTY')
    .map((member) => {
      const lastDate = lastActivityMap.get(member.id);
      let daysSinceJoin = 999;
      if (member.first_seen) {
        daysSinceJoin = Math.floor(
          (today.getTime() - new Date(member.first_seen).getTime()) / 86400000
        );
      }
      const days = lastDate
        ? Math.min(
            Math.floor((today.getTime() - new Date(lastDate).getTime()) / 86400000),
            daysSinceJoin
          )
        : Math.min(daysSinceJoin, 999);

      return { ign: member.ign, category: getCategory(days) };
    })
    .filter((m) => m.category !== 'active');

  let message: string;

  if (inactiveMembers.length === 0) {
    message = `**${config.guild_name} - Inactivity Report**\n*Generated: ${new Date().toLocaleDateString()}*\n\n✅ No inactive members! Everyone met their activity requirements.`;
  } else {
    message = formatInactivityReport(inactiveMembers, config.guild_name);
  }

  // Discord content limit is 2000 chars
  const content = message.length > 2000 ? message.slice(0, 1997) + '...' : message;

  const discordRes = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });

  if (!discordRes.ok) {
    const errText = await discordRes.text();
    console.error('[Discord Send] Failed:', discordRes.status, errText);
    return NextResponse.json({ error: 'Discord rejected the message' }, { status: 502 });
  }

  return NextResponse.json({ success: true });
}
