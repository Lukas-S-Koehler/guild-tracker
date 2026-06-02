import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, createAdminClient } from '@/lib/supabase-server';
import { verifySuperAdminOrRole, isErrorResponse } from '@/lib/auth-helpers';
import { IdleMMOApi } from '@/lib/idlemmo-api';
import { storeActivityEvents, processActivityEvents } from '@/lib/activity-processor';

// POST /api/admin/trigger-fetch
// Officers can manually trigger an activity fetch for their current guild
export async function POST(req: NextRequest) {
  const auth = await verifySuperAdminOrRole(req, 'OFFICER');
  if (isErrorResponse(auth)) return auth;

  const { guildId } = auth;
  const userSupabase = createServerClient(req);
  const adminSupabase = createAdminClient();

  // Get API key for this guild
  const { data: config, error: configError } = await userSupabase
    .from('guild_config')
    .select('api_key')
    .eq('guild_id', guildId)
    .single();

  if (configError || !config?.api_key || config.api_key === 'placeholder') {
    return NextResponse.json(
      { error: 'No API key configured for this guild. Set it in Admin > Guild Settings.' },
      { status: 400 }
    );
  }

  try {
    const api = new IdleMMOApi(config.api_key);
    const allEvents = [];

    for (let page = 1; page <= 3; page++) {
      const response = await api.getGuildActivity(guildId, page);
      if (!response.activity?.length) break;
      allEvents.push(...response.activity);
      if (!response.pagination.has_more) break;
      await new Promise(r => setTimeout(r, 300));
    }

    const stored = await storeActivityEvents(allEvents, guildId, adminSupabase);
    const { processed, joins, leaves } = await processActivityEvents(
      allEvents,
      guildId,
      adminSupabase,
      config.api_key
    );

    // Record last_fetched_at in settings
    const { data: existingConfig } = await adminSupabase
      .from('guild_config')
      .select('settings')
      .eq('guild_id', guildId)
      .single();
    await adminSupabase
      .from('guild_config')
      .update({ settings: { ...(existingConfig?.settings || {}), last_fetched_at: new Date().toISOString() } })
      .eq('guild_id', guildId);

    return NextResponse.json({ success: true, stored, processed, joins, leaves });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
