import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { IdleMMOApi } from '@/lib/idlemmo-api';

export const dynamic = 'force-dynamic';

const SUPER_ADMIN_USER_ID = '5f33bb41-86ab-4024-a1da-6a2fea5fb36b';

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

  const { data: keyRow } = await supabase
    .from('user_api_keys')
    .select('api_key')
    .eq('user_id', SUPER_ADMIN_USER_ID)
    .single();

  if (!keyRow?.api_key) {
    return NextResponse.json({ error: 'No API key configured for super admin' }, { status: 400 });
  }

  const api = new IdleMMOApi(keyRow.api_key);
  const list = await api.getEnemiesList();
  const enemies = list.enemies ?? [];

  const enemyRows = enemies.map((e) => ({
    id: e.id,
    name: e.name,
    level: e.level,
    zone_id: e.location.id,
    zone_name: e.location.name,
    health: e.health,
    experience: e.experience,
    chance_of_loot: e.chance_of_loot,
    image_url: e.image_url,
    loot: e.loot ?? [],
    updated_at: new Date().toISOString(),
  }));

  let enemyError: string | null = null;
  if (enemyRows.length > 0) {
    const { error } = await supabase
      .from('combat_enemies')
      .upsert(enemyRows, { onConflict: 'id' });
    if (error) enemyError = error.message;
  }

  // Seed market_cache with any new loot item_names so the next price sync picks them up.
  const lootNames = Array.from(
    new Set(enemies.flatMap((e) => (e.loot ?? []).map((l) => l.name.toLowerCase())))
  );
  let newItems = 0;
  if (lootNames.length > 0) {
    const { data: existing } = await supabase
      .from('market_cache')
      .select('item_name')
      .in('item_name', lootNames);
    const have = new Set((existing ?? []).map((r) => (r.item_name as string).toLowerCase()));
    const missing = lootNames.filter((n) => !have.has(n));
    if (missing.length > 0) {
      const inserts = missing.map((item_name) => ({ item_name, price: 0 }));
      const { error } = await supabase.from('market_cache').insert(inserts);
      if (!error) newItems = missing.length;
    }
  }

  return NextResponse.json({
    success: true,
    enemies: enemyRows.length,
    new_loot_items: newItems,
    enemy_error: enemyError,
  });
}
