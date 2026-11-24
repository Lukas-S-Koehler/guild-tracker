import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { refreshBuiltLive } from '@/lib/live-messages';
import { postDueRecaps } from '@/lib/assault-recap';
import { postDueKudosShoutout } from '@/lib/kudos';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// POST /api/cron/discord-live — rebuild the bound live Discord messages (guild directory,
// raid schedule, links hub). Unchanged messages are skipped. Runs after the daily activity check.
// Also posts assault season recaps once a guild's season_end has passed (step 10)
// and the weekly kudos shoutout once per week, from Monday on (step 14).
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('Authorization');
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const supabase = createAdminClient();
  const results = await refreshBuiltLive(supabase);
  const recaps = await postDueRecaps(supabase).catch((err) => String(err));
  const kudos = await postDueKudosShoutout(supabase).catch((err) => String(err));
  return NextResponse.json({ ok: true, results, recaps, kudos });
}
