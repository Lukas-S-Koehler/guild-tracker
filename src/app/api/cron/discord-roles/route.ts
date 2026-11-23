import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { AUTO_SYNC_SETTING, applyRoleChanges, planRoleSync } from '@/lib/discord-roles';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// POST /api/cron/discord-roles — daily Discord role sync after the members sync.
// Does nothing until "Daily auto sync" is switched on in Admin → Discord → Role sync.
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('Authorization');
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const supabase = createAdminClient();
  const { data: auto } = await supabase.from('app_settings').select('value').eq('key', AUTO_SYNC_SETTING).maybeSingle();
  if (auto?.value !== 'true') return NextResponse.json({ ok: true, skipped: 'auto sync off' });
  try {
    const plan = await planRoleSync(supabase);
    const result = await applyRoleChanges(plan.changes);
    return NextResponse.json({ ok: true, users: plan.changes.length, unmapped: plan.unmapped.length, ...result });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
