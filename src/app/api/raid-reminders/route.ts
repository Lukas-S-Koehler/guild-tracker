import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { verifySuperAdmin, isErrorResponse } from '@/lib/auth-helpers';

export async function GET(req: NextRequest) {
  const auth = await verifySuperAdmin(req);
  if (isErrorResponse(auth)) return auth;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('raid_reminders')
    .select('*')
    .order('time_utc', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const auth = await verifySuperAdmin(req);
  if (isErrorResponse(auth)) return auth;

  const body = await req.json();
  const { name, time_utc, discord_channel_id, message, role_ping_id, enabled, days_of_week } = body ?? {};

  if (!name || !time_utc || !discord_channel_id || !message) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(time_utc)) {
    return NextResponse.json({ error: 'time_utc must be HH:MM or HH:MM:SS' }, { status: 400 });
  }
  let dowClean: number[] | null = null;
  if (days_of_week != null) {
    if (!Array.isArray(days_of_week) || !days_of_week.every(d => Number.isInteger(d) && d >= 0 && d <= 6)) {
      return NextResponse.json({ error: 'days_of_week must be int[] with values 0..6' }, { status: 400 });
    }
    dowClean = Array.from(new Set(days_of_week as number[])).sort();
    if (dowClean.length === 0) dowClean = null;
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('raid_reminders')
    .insert({
      name,
      time_utc,
      discord_channel_id,
      message,
      role_ping_id: role_ping_id || null,
      enabled: enabled ?? true,
      days_of_week: dowClean,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
