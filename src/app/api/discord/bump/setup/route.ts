import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { postBumpButton, registerBumpsCommand } from '@/lib/discord-api';
import { readBumpConfig, updateBumpConfig } from '@/lib/bump-stats';

export const dynamic = 'force-dynamic';

// GET /api/discord/bump/setup
//   ?action=register-command           → register /bumps slash command
//   ?guild_id=<game-guild-id>&channel_id=<id>  → post button, save ids
//   ?guild_id=<game-guild-id>&role_id=<id>     → save bump_king_role_id
// All require Authorization: Bearer CRON_SECRET.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('Authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);

  if (searchParams.get('action') === 'register-command') {
    const result = await registerBumpsCommand();
    return NextResponse.json(result);
  }

  const guildId = searchParams.get('guild_id');
  if (!guildId) {
    return NextResponse.json({ ok: false, error: 'guild_id required' }, { status: 400 });
  }

  const supabase = createAdminClient();
  const channelId = searchParams.get('channel_id');
  const roleId = searchParams.get('role_id');

  const patch: Record<string, unknown> = {};

  if (channelId) {
    const result = await postBumpButton(channelId);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
    }
    patch.bump_channel_id = channelId;
    patch.bump_button_message_id = result.messageId;
  }

  if (roleId) {
    patch.bump_king_role_id = roleId;
  }

  if (Object.keys(patch).length === 0) {
    const current = await readBumpConfig(supabase, guildId);
    return NextResponse.json({ ok: true, current });
  }

  await updateBumpConfig(supabase, guildId, patch);
  const current = await readBumpConfig(supabase, guildId);
  return NextResponse.json({ ok: true, updated: patch, current });
}
