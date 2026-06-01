import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { verifyAuth, isErrorResponse } from '@/lib/auth-helpers';

// GET /api/guild-activity?date=YYYY-MM-DD
// Returns processed daily activity for the current guild and date
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req, 'MEMBER');
  if (isErrorResponse(auth)) return auth;

  const { guildId } = auth;
  const supabase = createServerClient(req);
  const { searchParams } = new URL(req.url);

  const date = searchParams.get('date') || new Date().toISOString().substring(0, 10);

  const { data: logs, error } = await supabase
    .from('daily_logs')
    .select(`
      id,
      log_date,
      raids,
      gold_donated,
      deposits_gold,
      met_requirement,
      log_order,
      members (
        id,
        ign,
        avatar_url,
        position,
        total_level,
        first_seen
      )
    `)
    .eq('guild_id', guildId)
    .eq('log_date', date)
    .order('log_order', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Also fetch donations for this date and guild
  const logIds = logs?.map((l: any) => l.id) || [];
  let donations: any[] = [];

  if (logIds.length > 0) {
    const { data: donationData } = await supabase
      .from('donations')
      .select('daily_log_id, item_name, quantity, unit_price, gold_value')
      .in('daily_log_id', logIds);
    donations = donationData || [];
  }

  // Group donations by log ID
  const donationsByLog: Record<string, any[]> = {};
  for (const d of donations) {
    if (!donationsByLog[d.daily_log_id]) donationsByLog[d.daily_log_id] = [];
    donationsByLog[d.daily_log_id].push(d);
  }

  const result = (logs || []).map((log: any) => ({
    ...log,
    donations: donationsByLog[log.id] || [],
  }));

  return NextResponse.json(result);
}
