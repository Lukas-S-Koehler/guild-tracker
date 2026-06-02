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

  const body = await req.json().catch(() => ({}));
  const { guild_id, days = 30 } = body as { guild_id?: string; days?: number };

  const supabase = createAdminClient();

  // Determine which guilds to backfill
  let guildsQuery = supabase
    .from('guild_config')
    .select('guild_id, api_key')
    .neq('api_key', 'placeholder')
    .not('api_key', 'is', null);

  if (guild_id) {
    guildsQuery = guildsQuery.eq('guild_id', guild_id);
  }

  const { data: guilds, error: guildsError } = await guildsQuery;

  if (guildsError || !guilds || guilds.length === 0) {
    return NextResponse.json(
      { error: 'No guilds found or guild has no API key configured', details: guildsError?.message },
      { status: 404 }
    );
  }

  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - days);

  const results: Record<string, { stored: number; processed: number; pages: number; error?: string }> = {};

  for (const guild of guilds) {
    const { guild_id: gId, api_key } = guild;

    try {
      const api = new IdleMMOApi(api_key);
      const allEvents = await api.getAllGuildActivitySince(gId, sinceDate);

      const stored = await storeActivityEvents(allEvents, gId, supabase);
      const { processed } = await processActivityEvents(allEvents, gId, supabase, api_key);

      // Estimate pages fetched (20 items per page is typical)
      const pages = Math.ceil(allEvents.length / 20);
      results[gId] = { stored, processed, pages };
    } catch (err) {
      results[gId] = { stored: 0, processed: 0, pages: 0, error: String(err) };
    }

    // Let rate limit window reset between guilds
    if (guilds.indexOf(guild) < guilds.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 60000));
    }
  }

  return NextResponse.json({
    success: true,
    days,
    sinceDate: sinceDate.toISOString(),
    results,
  });
}
