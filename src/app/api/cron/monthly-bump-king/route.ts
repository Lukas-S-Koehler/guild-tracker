import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { addGuildMemberRole, removeGuildMemberRole, postToChannel } from '@/lib/discord-api';
import { displayName, getPrevMonthTop, readBumpConfig, updateBumpConfig } from '@/lib/bump-stats';

export const dynamic = 'force-dynamic';

// POST /api/cron/monthly-bump-king
// Called on 1st of month. For each guild with bump_king_role_id configured:
//   - find previous month's top bumper
//   - revoke role from previous king, assign to new winner
//   - announce in bump channel
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('Authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient();

  const { data: guilds } = await supabase
    .from('guild_config')
    .select('guild_id, settings');

  const results: Array<{ guild_id: string; status: string; winner?: string; count?: number }> = [];

  for (const g of guilds ?? []) {
    const settings = (g.settings ?? {}) as {
      discord_server_id?: string;
      bump_channel_id?: string;
      bump_king_role_id?: string;
      current_bump_king_discord_id?: string;
    };
    const discordGuildId = settings.discord_server_id;
    const roleId = settings.bump_king_role_id;
    if (!discordGuildId || !roleId) {
      results.push({ guild_id: g.guild_id, status: 'skip_no_config' });
      continue;
    }

    const top = await getPrevMonthTop(supabase, g.guild_id);
    if (!top) {
      results.push({ guild_id: g.guild_id, status: 'no_bumps_last_month' });
      continue;
    }

    // Revoke from previous king (if different)
    const prevKing = settings.current_bump_king_discord_id;
    if (prevKing && prevKing !== top.discord_id) {
      await removeGuildMemberRole(discordGuildId, prevKing, roleId);
    }

    const addResult = await addGuildMemberRole(discordGuildId, top.discord_id, roleId);
    if (!addResult.ok) {
      results.push({ guild_id: g.guild_id, status: `role_add_failed: ${addResult.error}` });
      continue;
    }

    await updateBumpConfig(supabase, g.guild_id, {
      current_bump_king_discord_id: top.discord_id,
    });

    // Announce
    if (settings.bump_channel_id) {
      const monthName = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 1, 1))
        .toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
      const msg = [
        '# 👑 BUMP KING',
        '',
        `All hail <@${top.discord_id}> — **${displayName(top)}** — top bumper of **${monthName}** with **${top.count}** bumps! 🚀`,
        '',
        `Role <@&${roleId}> awarded. Keep the hype going for this month!`,
      ].join('\n');
      await postToChannel(settings.bump_channel_id, msg);
    }

    results.push({
      guild_id: g.guild_id,
      status: 'crowned',
      winner: top.discord_id,
      count: top.count,
    });
  }

  // Silence unused import warning if helper not needed
  void readBumpConfig;

  return NextResponse.json({ ok: true, results });
}
