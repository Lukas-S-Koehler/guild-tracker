import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { IdleMMOApi } from '@/lib/idlemmo-api';
import { storeActivityEvents, processActivityEvents } from '@/lib/activity-processor';

function verifyCronSecret(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get('authorization');
  return auth === `Bearer ${secret}`;
}

export async function POST(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient();

  // Fetch all guilds that have a real API key configured
  const { data: guilds, error: guildsError } = await supabase
    .from('guild_config')
    .select('guild_id, api_key')
    .neq('api_key', 'placeholder')
    .not('api_key', 'is', null);

  if (guildsError || !guilds) {
    return NextResponse.json({ error: 'Failed to fetch guilds', details: guildsError?.message }, { status: 500 });
  }

  const results: Record<string, { stored: number; processed: number; joins: string[]; leaves: string[]; error?: string }> = {};

  // Track which guilds need member sync due to joins
  const guildsNeedingSync: string[] = [];

  for (const guild of guilds) {
    const { guild_id, api_key } = guild;

    try {
      const api = new IdleMMOApi(api_key);

      // Fetch latest activity (page 1 gets most recent — enough for daily run)
      // Fetch up to 3 pages to catch any backlog since last run
      const allEvents = [];
      for (let page = 1; page <= 3; page++) {
        const response = await api.getGuildActivity(guild_id, page);
        if (!response.activity?.length) break;
        allEvents.push(...response.activity);
        if (!response.pagination.has_more) break;
        await new Promise(r => setTimeout(r, 300));
      }

      // Store raw events (idempotent via upsert)
      const stored = await storeActivityEvents(allEvents, guild_id, supabase);

      // Process into daily_logs
      const { processed, joins, leaves } = await processActivityEvents(
        allEvents,
        guild_id,
        supabase,
        api_key
      );

      results[guild_id] = { stored, processed, joins, leaves };

      if (joins.length > 0) {
        guildsNeedingSync.push(guild_id);
      }
    } catch (err) {
      results[guild_id] = { stored: 0, processed: 0, joins: [], leaves: [], error: String(err) };
    }
  }

  return NextResponse.json({
    success: true,
    guildsProcessed: guilds.length,
    guildsNeedingMemberSync: guildsNeedingSync,
    results,
  });
}
