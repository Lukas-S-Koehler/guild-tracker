import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { IdleMMOApi } from '@/lib/idlemmo-api';
import { fetchPotionDurationMinutes } from '@/lib/idlemmo-potion-meta';
import { verifySuperAdmin, isErrorResponse } from '@/lib/auth-helpers';

export const dynamic = 'force-dynamic';

const SUPER_ADMIN_USER_ID = '5f33bb41-86ab-4024-a1da-6a2fea5fb36b';

export async function POST(req: NextRequest) {
  const auth = await verifySuperAdmin(req);
  if (isErrorResponse(auth)) return auth;

  const supabase = createAdminClient();

  const { data: keyRow } = await supabase
    .from('user_api_keys')
    .select('api_key')
    .eq('user_id', SUPER_ADMIN_USER_ID)
    .single();
  if (!keyRow?.api_key) {
    return NextResponse.json({ error: 'No API key configured' }, { status: 400 });
  }
  const api = new IdleMMOApi(keyRow.api_key);

  const [{ data: combat }, { data: xp }] = await Promise.all([
    supabase.from('combat_potions').select('id, name, hashed_item_id'),
    supabase.from('xp_potions').select('id, name, hashed_item_id'),
  ]);

  const results = { combat_updated: 0, xp_updated: 0, skipped: [] as string[] };

  for (const row of combat ?? []) {
    if (!row.hashed_item_id) { results.skipped.push(row.name); continue; }
    const mins = await fetchPotionDurationMinutes(api, row.hashed_item_id);
    if (mins == null) { results.skipped.push(row.name); continue; }
    await supabase.from('combat_potions').update({ duration_minutes: mins, updated_at: new Date().toISOString() }).eq('id', row.id);
    results.combat_updated++;
    await new Promise((r) => setTimeout(r, 200));
  }
  for (const row of xp ?? []) {
    if (!row.hashed_item_id) { results.skipped.push(row.name); continue; }
    const mins = await fetchPotionDurationMinutes(api, row.hashed_item_id);
    if (mins == null) { results.skipped.push(row.name); continue; }
    await supabase.from('xp_potions').update({ duration_minutes: mins, updated_at: new Date().toISOString() }).eq('id', row.id);
    results.xp_updated++;
    await new Promise((r) => setTimeout(r, 200));
  }

  return NextResponse.json({ success: true, ...results });
}
