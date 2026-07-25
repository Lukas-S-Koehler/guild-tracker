import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { postToChannel } from '@/lib/discord-api';

// pg_cron fires this every minute. We pick reminders whose time_utc == current UTC HH:MM.
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('Authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const hh = String(now.getUTCHours()).padStart(2, '0');
  const mm = String(now.getUTCMinutes()).padStart(2, '0');
  const currentMinute = `${hh}:${mm}:00`;

  const supabase = createAdminClient();
  const { data: reminders, error } = await supabase
    .from('raid_reminders')
    .select('id, name, message, discord_channel_id, role_ping_id')
    .eq('enabled', true)
    .eq('time_utc', currentMinute);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results: Array<{ id: string; name: string; ok: boolean; error?: string }> = [];
  for (const r of reminders ?? []) {
    const prefix = r.role_ping_id ? `<@&${r.role_ping_id}> ` : '';
    const res = await postToChannel(r.discord_channel_id, `${prefix}${r.message}`);
    results.push({ id: r.id, name: r.name, ok: res.ok, error: res.error });
  }

  return NextResponse.json({ ok: true, fired: results.length, minute: currentMinute, results });
}

// Optional GET for manual smoke test
export async function GET(req: NextRequest) {
  return POST(req);
}
