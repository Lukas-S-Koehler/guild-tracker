import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, createAdminClient } from '@/lib/supabase-server';
import { SUPER_ADMIN_EMAIL } from '@/lib/auth-helpers';
import { postBumpButton, registerBumpsCommand } from '@/lib/discord-api';
import { readBumpConfig, writeBumpConfig } from '@/lib/bump-stats';

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
//   (no action)                  → read global bump config
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
  const config = await readBumpConfig(supabase);
  return NextResponse.json({ ok: true, config });
}

// POST /api/admin/bump-install
// body: { bump_server_id?, bump_channel_id?, bump_king_role_id?, install?: boolean }
export async function POST(req: NextRequest) {
  const forbidden = await requireSuperAdmin(req);
  if (forbidden) return forbidden;

  const body = await req.json().catch(() => ({}));
  const { bump_server_id, bump_channel_id, bump_king_role_id, install } = body as {
    bump_server_id?: string;
    bump_channel_id?: string;
    bump_king_role_id?: string;
    install?: boolean;
  };

  const supabase = createAdminClient();

  const patch: Record<string, string> = {};
  if (bump_server_id !== undefined) patch.bump_server_id = bump_server_id;
  if (bump_channel_id !== undefined) patch.bump_channel_id = bump_channel_id;
  if (bump_king_role_id !== undefined) patch.bump_king_role_id = bump_king_role_id;

  let newMessageId: string | undefined;
  if (install) {
    const current = await readBumpConfig(supabase);
    const channel = bump_channel_id ?? current.bump_channel_id;
    if (!channel) {
      return NextResponse.json({ error: 'bump_channel_id required to install' }, { status: 400 });
    }
    const result = await postBumpButton(channel);
    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? 'Failed to post button' }, { status: 500 });
    }
    newMessageId = result.messageId;
    patch.bump_button_message_id = result.messageId ?? '';
  }

  if (Object.keys(patch).length > 0) {
    await writeBumpConfig(supabase, patch);
  }

  const config = await readBumpConfig(supabase);
  return NextResponse.json({ ok: true, message_id: newMessageId, config });
}
