import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { runAchievements } from '@/lib/achievement-eval';
import { postHallOfFame } from '@/lib/achievement-discord';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// POST /api/cron/achievements — evaluate every account, record new unlocks, then post the
// #hall-of-fame digest (Silver+). First run ever = silent backfill + one launch post.
// Runs in the daily-activity workflow after the activity check. Body { dry_run: true } previews.
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('Authorization');
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const dryRun = body?.dry_run === true;
  const supabase = createAdminClient();
  try {
    const run = await runAchievements(supabase, { dryRun });
    const summary = { accounts: run.accounts, new_unlocks: run.new_unlocks, backfill: run.backfill, by_tier: run.by_tier };
    if (dryRun) return NextResponse.json({ ok: true, dry_run: true, ...summary });
    // Checked game day = yesterday (UTC).
    const day = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const feed = await postHallOfFame(supabase, day);
    return NextResponse.json({ ok: true, ...summary, feed });
  } catch (err) {
    console.error('[cron/achievements]', err);
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 500 });
  }
}
