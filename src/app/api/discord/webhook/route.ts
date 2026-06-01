import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { verifyAuth, isErrorResponse } from '@/lib/auth-helpers';

export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req, 'OFFICER');
  if (isErrorResponse(auth)) return auth;

  const body = await req.json();
  const { webhook_url } = body;

  if (!webhook_url || !webhook_url.startsWith('https://discord.com/api/webhooks/')) {
    return NextResponse.json({ error: 'Invalid Discord webhook URL' }, { status: 400 });
  }

  const supabase = createServerClient(req);

  const { data: existing, error: fetchError } = await supabase
    .from('guild_config')
    .select('id, settings')
    .eq('guild_id', auth.guildId)
    .single();

  if (fetchError || !existing) {
    return NextResponse.json({ error: 'Guild config not found. Set up the guild first.' }, { status: 404 });
  }

  const { error } = await supabase
    .from('guild_config')
    .update({
      settings: { ...existing.settings, discord_webhook_url: webhook_url },
      updated_at: new Date().toISOString(),
    })
    .eq('id', existing.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest) {
  const auth = await verifyAuth(req, 'OFFICER');
  if (isErrorResponse(auth)) return auth;

  const supabase = createServerClient(req);

  const { data: existing } = await supabase
    .from('guild_config')
    .select('id, settings')
    .eq('guild_id', auth.guildId)
    .single();

  if (!existing) {
    return NextResponse.json({ error: 'Guild config not found' }, { status: 404 });
  }

  const { discord_webhook_url: _removed, ...restSettings } = existing.settings || {};

  const { error } = await supabase
    .from('guild_config')
    .update({ settings: restSettings, updated_at: new Date().toISOString() })
    .eq('id', existing.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
