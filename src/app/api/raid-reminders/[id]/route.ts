import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { verifySuperAdmin, isErrorResponse } from '@/lib/auth-helpers';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await verifySuperAdmin(req);
  if (isErrorResponse(auth)) return auth;

  const body = await req.json();
  const allowed: Record<string, unknown> = {};
  for (const key of ['name', 'time_utc', 'discord_channel_id', 'message', 'role_ping_id', 'enabled']) {
    if (key in body) allowed[key] = body[key];
  }
  if (allowed.time_utc && !/^\d{2}:\d{2}(:\d{2})?$/.test(String(allowed.time_utc))) {
    return NextResponse.json({ error: 'time_utc must be HH:MM or HH:MM:SS' }, { status: 400 });
  }
  allowed.updated_at = new Date().toISOString();

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('raid_reminders')
    .update(allowed)
    .eq('id', params.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await verifySuperAdmin(req);
  if (isErrorResponse(auth)) return auth;

  const supabase = createAdminClient();
  const { error } = await supabase.from('raid_reminders').delete().eq('id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
