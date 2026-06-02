import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { verifyGuildLeader } from '@/lib/auth-helpers';
import { isErrorResponse } from '@/lib/auth-helpers';
import { IdleMMOApi } from '@/lib/idlemmo-api';
import { storeActivityEvents, processActivityEvents } from '@/lib/activity-processor';

// POST /api/admin/backfill
// Dream Bandits leader can trigger a historical backfill for any guild
export async function POST(req: NextRequest) {
  const auth = await verifyGuildLeader(req, 'Dream Bandits');
  if (isErrorResponse(auth)) return auth;

  const body = await req.json().catch(() => ({}));
  const { guild_id, days = 30 } = body as { guild_id?: string; days?: number };

  if (!guild_id) {
    return NextResponse.json({ error: 'guild_id required' }, { status: 400 });
  }

  const supabase = createAdminClient();

  const { data: config } = await supabase
    .from('guild_config')
    .select('api_key, guild_name')
    .eq('guild_id', guild_id)
    .single();

  if (!config?.api_key || config.api_key === 'placeholder') {
    return NextResponse.json(
      { error: 'No API key configured for this guild. Set it in Settings first.' },
      { status: 400 }
    );
  }

  try {
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - days);

    const api = new IdleMMOApi(config.api_key);
    const allEvents = await api.getAllGuildActivitySince(guild_id, sinceDate);

    const stored = await storeActivityEvents(allEvents, guild_id, supabase);
    const { processed, joins, leaves } = await processActivityEvents(allEvents, guild_id, supabase, config.api_key);

    const { data: existingConfig } = await supabase
      .from('guild_config')
      .select('settings')
      .eq('guild_id', guild_id)
      .single();
    await supabase
      .from('guild_config')
      .update({ settings: { ...(existingConfig?.settings || {}), last_fetched_at: new Date().toISOString() } })
      .eq('guild_id', guild_id);

    return NextResponse.json({
      success: true,
      guild_id,
      days,
      stored,
      processed,
      joins,
      leaves,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
