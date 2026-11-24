import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, createAdminClient } from '@/lib/supabase-server';
import { verifySuperAdminOrRole, isErrorResponse } from '@/lib/auth-helpers';
import { IdleMMOApi } from '@/lib/idlemmo-api';
import { storeActivityEvents, processActivityEvents } from '@/lib/activity-processor';
import { recordFetchRun } from '@/lib/fetch-runs';

export const dynamic = 'force-dynamic';

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

  const { data: existingConfig } = await adminSupabase
    .from('guild_config')
    .select('settings')
    .eq('guild_id', guildId)
    .single();
  const prev = existingConfig?.settings?.last_fetched_at ? Date.parse(existingConfig.settings.last_fetched_at) : null;
  const cutoff = prev !== null ? prev - 2 * 60 * 60 * 1000 : null;

  try {
    const api = new IdleMMOApi(config.api_key);
    const allEvents = [];

    // Read back to the daily cron's cursor (cap 25 pages) so moving the cursor never skips events.
    let reached = false;
    for (let page = 1; page <= 25; page++) {
      const response = await api.getGuildActivity(guildId, page);
      if (!response.activity?.length) { reached = true; break; }
      for (const e of response.activity) {
        if (cutoff !== null && Date.parse(e.created_at) < cutoff) reached = true;
        else allEvents.push(e);
      }
      if (reached || !response.pagination.has_more) { reached = true; break; }
      await new Promise(r => setTimeout(r, 300));
    }

    const stored = await storeActivityEvents(allEvents, guildId, adminSupabase);
    const { processed, joins, leaves } = await processActivityEvents(
      allEvents,
      guildId,
      adminSupabase,
      config.api_key
    );
    await recordFetchRun(adminSupabase, {
      guild_id: guildId,
      source: 'manual',
      ok: reached,
      events: allEvents.length,
      covered_from: cutoff !== null ? new Date(cutoff) : null,
      covered_to: new Date(),
      error: reached ? null : 'stopped at 25 pages before reaching the last fetch',
    });

    if (reached) {
      await adminSupabase
        .from('guild_config')
        .update({ settings: { ...(existingConfig?.settings || {}), last_fetched_at: new Date().toISOString() } })
        .eq('guild_id', guildId);
    }

    return NextResponse.json({ success: true, stored, processed, joins, leaves });
  } catch (err) {
    await recordFetchRun(adminSupabase, { guild_id: guildId, source: 'manual', ok: false, covered_from: cutoff !== null ? new Date(cutoff) : null, error: String(err) });
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
