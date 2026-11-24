import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { pollChat } from '@/lib/discord-chat';
import { runDreamPass } from '@/lib/dream-pass-eval';
import { postDreamPass } from '@/lib/dream-pass-discord';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// POST /api/cron/dream-pass — Dream Pass (step 15), in the daily-activity workflow after achievements
// and before the Discord role sync (rank + Season Champion roles read its numbers).
//  1. Read new Discord chat (cursor per channel; the first runs backfill history within a time budget).
//  2. Recompute season + lifetime XP for every account, record level milestones, freeze ended seasons.
//  3. #hall-of-fame: launch post (once), season results, level milestones.
// Body: { dry_run: true } previews without writing; { skip_chat: true } skips step 1;
// { chat_only: true } only reads chat (workflow discord-chat.yml, backfill); { skip_feed: true } posts nothing.
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('Authorization');
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const dryRun = body?.dry_run === true;
  const supabase = createAdminClient();
  try {
    const chat = body?.skip_chat || dryRun ? 'skipped' : await pollChat(supabase, { budgetMs: body?.chat_only ? 240_000 : 110_000 }).catch((e) => `error: ${String(e)}`);
    if (body?.chat_only) return NextResponse.json({ ok: true, chat });
    const run = await runDreamPass(supabase, { dryRun });
    if (dryRun) return NextResponse.json({ ok: true, dry_run: true, ...run });
    const feed = body?.skip_feed ? 'skipped' : await postDreamPass(supabase);
    return NextResponse.json({ ok: true, chat, ...run, feed });
  } catch (err) {
    console.error('[cron/dream-pass]', err);
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 500 });
  }
}
