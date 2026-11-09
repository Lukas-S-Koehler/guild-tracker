import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, createAdminClient } from '@/lib/supabase-server';
import { SUPER_ADMIN_EMAIL } from '@/lib/auth-helpers';
import { postBumpButton, registerBumpsCommand } from '@/lib/discord-api';

export const dynamic = 'force-dynamic';

async function requireSuperAdmin(req: NextRequest): Promise<NextResponse | null> {
  const supabase = createServerClient(req);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || user.email !== SUPER_ADMIN_EMAIL) {
    return NextResponse.json({ error: 'Super admin only' }, { status: 403 });
  }
  return null;
}

// GET /api/admin/bump-install
//   (no action)                  → list all guilds + bump config
//   ?action=register-command     → register /bumps slash command
export async function GET(req: NextRequest) {
  const forbidden = await requireSuperAdmin(req);
  if (forbidden) return forbidden;

  const { searchParams } = new URL(req.url);

  if (searchParams.get('action') === 'register-command') {
    const result = await registerBumpsCommand();
    return NextResponse.json(result);
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('guild_config')
    .select('guild_id, guild_name, settings')
    .order('guild_name', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []).map((r) => {
    const s = (r.settings ?? {}) as {
      discord_server_id?: string;
      bump_channel_id?: string;
      bump_king_role_id?: string;
      bump_button_message_id?: string;
      current_bump_king_discord_id?: string;
    };
    return {
      guild_id: r.guild_id,
      guild_name: r.guild_name,
      discord_server_id: s.discord_server_id ?? '',
      bump_channel_id: s.bump_channel_id ?? '',
      bump_king_role_id: s.bump_king_role_id ?? '',
      bump_button_message_id: s.bump_button_message_id ?? '',
      current_bump_king_discord_id: s.current_bump_king_discord_id ?? '',
    };
  });

  return NextResponse.json({ ok: true, guilds: rows });
}

// POST /api/admin/bump-install
// body: { guild_id, bump_channel_id?, bump_king_role_id?, install?: boolean }
export async function POST(req: NextRequest) {
  const forbidden = await requireSuperAdmin(req);
  if (forbidden) return forbidden;

  const body = await req.json().catch(() => ({}));
  const { guild_id, bump_channel_id, bump_king_role_id, install } = body as {
    guild_id?: string;
    bump_channel_id?: string;
    bump_king_role_id?: string;
    install?: boolean;
  };

  if (!guild_id) {
    return NextResponse.json({ error: 'guild_id required' }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data: existing } = await supabase
    .from('guild_config')
    .select('settings')
    .eq('guild_id', guild_id)
    .maybeSingle();

  const merged: Record<string, unknown> = {
    ...((existing?.settings as Record<string, unknown>) ?? {}),
  };

  if (bump_channel_id !== undefined) merged.bump_channel_id = bump_channel_id || null;
  if (bump_king_role_id !== undefined) merged.bump_king_role_id = bump_king_role_id || null;

  let newMessageId: string | undefined;
  if (install) {
    const channel = (bump_channel_id ?? merged.bump_channel_id) as string | undefined;
    if (!channel) {
      return NextResponse.json({ error: 'bump_channel_id required to install' }, { status: 400 });
    }
    const result = await postBumpButton(channel);
    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? 'Failed to post button' }, { status: 500 });
    }
    newMessageId = result.messageId;
    merged.bump_button_message_id = result.messageId;
  }

  const { error } = await supabase
    .from('guild_config')
    .update({ settings: merged })
    .eq('guild_id', guild_id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, message_id: newMessageId });
}
