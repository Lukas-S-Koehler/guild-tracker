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

  const { data: allItems, error } = await supabase
    .from('market_cache')
    .select('item_name');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Ensure potion names are tracked in market_cache
  const [{ data: combatPotions }, { data: xpPotions }] = await Promise.all([
    supabase.from('combat_potions').select('name, is_tradeable, hashed_item_id'),
    supabase.from('xp_potions').select('name, hashed_item_id'),
  ]);
  const potionNames = [
    ...(combatPotions ?? []).filter((p) => p.is_tradeable && p.hashed_item_id).map((p) => p.name),
    ...(xpPotions ?? []).filter((p) => p.hashed_item_id).map((p) => p.name),
  ];
  for (const name of potionNames) {
    await supabase
      .from('market_cache')
      .upsert({ item_name: name, price: 0, cached_at: new Date(0).toISOString() }, { onConflict: 'item_name', ignoreDuplicates: true });
  }

  // Refresh full list after seed
  const { data: allItemsAfterSeed } = await supabase.from('market_cache').select('item_name');
  const items = allItemsAfterSeed ?? allItems ?? [];
  let updated = 0;
  const failed: string[] = [];
  const now = new Date().toISOString();

  for (const { item_name } of items) {
    try {
      const { price, itemId } = await api.getItemPrice(item_name);
      if (price > 0) {
        await supabase.from('market_cache').upsert({
          item_name,
          item_id: itemId ?? null,
          price,
          cached_at: now,
        }, { onConflict: 'item_name' });
        // Mirror into potion tables
        await supabase
          .from('combat_potions')
          .update({ market_price: price, avg_recent_sales: String(price), last_price_sync: now })
          .eq('name', item_name);
        await supabase
          .from('xp_potions')
          .update({ market_price: price, avg_recent_sales: String(price), last_price_sync: now })
          .eq('name', item_name);
        updated++;
      } else {
        failed.push(item_name);
      }
    } catch {
      failed.push(item_name);
    }
  }

  return NextResponse.json({ success: true, total: items.length, updated, failed });
}
