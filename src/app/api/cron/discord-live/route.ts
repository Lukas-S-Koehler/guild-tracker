import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { refreshBuiltLive } from '@/lib/live-messages';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// POST /api/cron/discord-live — rebuild the bound live Discord messages (guild directory,
// raid schedule, links hub). Unchanged messages are skipped. Runs after the daily activity check.
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('Authorization');
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const results = await refreshBuiltLive(createAdminClient());
  return NextResponse.json({ ok: true, results });
}
