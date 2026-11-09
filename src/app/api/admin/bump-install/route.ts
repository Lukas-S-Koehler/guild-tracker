import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, createAdminClient } from '@/lib/supabase-server';
import { verifyAdminOrLeader, isErrorResponse } from '@/lib/auth-helpers';
import { postBumpButton, registerBumpsCommand } from '@/lib/discord-api';

export const dynamic = 'force-dynamic';

// POST /api/admin/bump-install
// body: { guild_id, channel_id }
// Posts the bump button in the channel, saves bump_channel_id + bump_button_message_id in guild_config.settings.
export async function POST(req: NextRequest) {
  const auth = await verifyAdminOrLeader(req);
  if (isErrorResponse(auth)) return auth;

  const body = await req.json().catch(() => ({}));
  const { guild_id, channel_id } = body as { guild_id?: string; channel_id?: string };

  if (!guild_id || !channel_id) {
    return NextResponse.json({ error: 'guild_id and channel_id required' }, { status: 400 });
  }
  if (!auth.isSuperAdmin && guild_id !== auth.guildId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const supabase = auth.isSuperAdmin ? createAdminClient() : createServerClient(req);

  const result = await postBumpButton(channel_id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? 'Failed to post button' }, { status: 500 });
  }

  const { data: existing } = await supabase
    .from('guild_config')
    .select('settings')
    .eq('guild_id', guild_id)
    .maybeSingle();

  const merged = {
    ...((existing?.settings as Record<string, unknown>) ?? {}),
    bump_channel_id: channel_id,
    bump_button_message_id: result.messageId,
  };

  const { error } = await supabase
    .from('guild_config')
    .update({ settings: merged })
    .eq('guild_id', guild_id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, message_id: result.messageId });
}

// GET /api/admin/bump-install?action=register-command
// Registers /bumps slash command globally. Super-admin only.
export async function GET(req: NextRequest) {
  const auth = await verifyAdminOrLeader(req);
  if (isErrorResponse(auth)) return auth;
  if (!auth.isSuperAdmin) {
    return NextResponse.json({ error: 'Super admin only' }, { status: 403 });
  }
  const { searchParams } = new URL(req.url);
  if (searchParams.get('action') === 'register-command') {
    const result = await registerBumpsCommand();
    return NextResponse.json(result);
  }
  return NextResponse.json({ ok: true });
}
