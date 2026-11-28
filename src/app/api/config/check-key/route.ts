import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { verifyAdminOrLeader, isErrorResponse } from '@/lib/auth-helpers';
import { checkGuildKey } from '@/lib/guild-key-check';

export const dynamic = 'force-dynamic';

/**
 * POST /api/config/check-key — test a guild key without saving it.
 * Body { api_key?: string }: the typed key, or the stored key when omitted / unchanged.
 */
export async function POST(req: NextRequest) {
  const auth = await verifyAdminOrLeader(req);
  if (isErrorResponse(auth)) return auth;
  if (!auth.guildId) return NextResponse.json({ error: 'No guild selected' }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const { data: cfg } = await createAdminClient()
    .from('guild_config')
    .select('api_key, guild_name, updated_at')
    .eq('guild_id', auth.guildId)
    .maybeSingle();

  const typed = typeof body.api_key === 'string' ? body.api_key.trim() : '';
  const key = typed || cfg?.api_key;
  if (!key || key === 'placeholder') return NextResponse.json({ ok: false, reason: 'No key saved for this guild yet.' });

  const check = await checkGuildKey(key, auth.guildId, cfg?.guild_name);
  return NextResponse.json({ ...check, saved: !typed || typed === cfg?.api_key, updated_at: cfg?.updated_at ?? null });
}
