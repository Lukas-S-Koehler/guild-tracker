import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { addGuildMemberRole, removeGuildMemberRole, postToChannel } from '@/lib/discord-api';
import { displayName, getPrevMonthTop, readBumpConfig, writeBumpConfig } from '@/lib/bump-stats';

export const dynamic = 'force-dynamic';

// POST /api/cron/monthly-bump-king
// Runs on 1st of month. One global bump tracker across the family of guilds.
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('Authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient();
  const cfg = await readBumpConfig(supabase);

  if (!cfg.bump_server_id || !cfg.bump_king_role_id) {
    return NextResponse.json({ ok: false, status: 'config_missing' });
  }

  const top = await getPrevMonthTop(supabase);
  if (!top) {
    return NextResponse.json({ ok: true, status: 'no_bumps_last_month' });
  }

  // Revoke previous king
  if (cfg.current_bump_king_discord_id && cfg.current_bump_king_discord_id !== top.discord_id) {
    await removeGuildMemberRole(cfg.bump_server_id, cfg.current_bump_king_discord_id, cfg.bump_king_role_id);
  }

  const addResult = await addGuildMemberRole(cfg.bump_server_id, top.discord_id, cfg.bump_king_role_id);
  if (!addResult.ok) {
    return NextResponse.json({ ok: false, status: 'role_add_failed', error: addResult.error });
  }

  await writeBumpConfig(supabase, { current_bump_king_discord_id: top.discord_id });

  if (cfg.bump_channel_id) {
    const now = new Date();
    const monthName = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
      .toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const msg = [
      '# 👑 BUMP KING',
      '',
      `All hail <@${top.discord_id}> — **${displayName(top)}** — top bumper of **${monthName}** with **${top.count}** bumps! 🚀`,
      '',
      `Role <@&${cfg.bump_king_role_id}> awarded. Who's dethroning them this month?`,
    ].join('\n');
    await postToChannel(cfg.bump_channel_id, msg);
  }

  return NextResponse.json({
    ok: true,
    status: 'crowned',
    winner: top.discord_id,
    count: top.count,
  });
}
