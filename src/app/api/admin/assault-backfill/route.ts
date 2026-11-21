import { NextRequest, NextResponse } from 'next/server';
import { IdleMMOApi } from '@/lib/idlemmo-api';
import { listTrackedGuilds } from '@/lib/assault-conquest-service';
import { getCurrentSeason, syncSeason } from '@/lib/assault-standings-service';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// POST /api/admin/assault-backfill?from=1&to=13  (Bearer CRON_SECRET)
// Loads standings + member contributions for historic seasons via season_number.
// Keep ranges small (a few seasons per call) to stay inside the function timeout.
export async function POST(req: NextRequest) {
  if (!process.env.CRON_SECRET || req.headers.get('Authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const current = await getCurrentSeason();
  const from = parseInt(searchParams.get('from') ?? '1', 10);
  const to = Math.min(parseInt(searchParams.get('to') ?? String(current), 10), current);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < 1 || from > to) {
    return NextResponse.json({ error: 'bad from/to' }, { status: 400 });
  }

  const tracked = await listTrackedGuilds();
  const key = tracked.find(t => t.api_key)?.api_key;
  if (!key) return NextResponse.json({ error: 'no api key available' }, { status: 400 });
  const ids = new Set(tracked.map(t => t.external_guild_id).filter((x): x is number => x != null));

  const api = new IdleMMOApi(key);
  const results: Record<number, unknown> = {};
  for (let season = to; season >= from; season--) {
    try {
      results[season] = await syncSeason(api, season, current, ids);
    } catch (e) {
      results[season] = { error: String(e) };
    }
  }
  return NextResponse.json({ ok: true, current, results });
}
