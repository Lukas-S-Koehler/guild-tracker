import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase';
import { IdleMMOApi } from '@/lib/idlemmo-api';
import { parseActivityLog, getUniqueItems } from '@/lib/parsers';
import type { ProcessedMember } from '@/types';

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const body = await req.json();

  const { raw_log } = body;

  if (!raw_log || !raw_log.trim()) {
    return NextResponse.json({ error: 'Activity log is required' }, { status: 400 });
  }

  // Get API key
  const { data: config } = await supabase
    .from('guild_config')
    .select('api_key')
    .limit(1)
    .single();

  if (!config?.api_key) {
    return NextResponse.json({ error: 'API key not configured. Go to Setup first.' }, { status: 400 });
  }

  try {
    // Parse the activity log
    const parsed = parseActivityLog(raw_log);
    const memberNames = Object.keys(parsed);

    if (memberNames.length === 0) {
      return NextResponse.json({ error: 'No valid activity found in log' }, { status: 400 });
    }

    // Get unique items that need price lookups
    const uniqueItems = getUniqueItems(parsed);

    // Check cache first
    const { data: cached } = await supabase
      .from('market_cache')
      .select('item_name, price')
      .in('item_name', uniqueItems.map(i => i.toLowerCase()));

    const cachedPrices: Record<string, number> = {};
    cached?.forEach(c => {
      cachedPrices[c.item_name.toLowerCase()] = c.price;
    });

    // Fetch prices for items not in cache
    const api = new IdleMMOApi(config.api_key);
    const prices: Record<string, number> = { ...cachedPrices };

    for (const itemName of uniqueItems) {
      if (cachedPrices[itemName.toLowerCase()] !== undefined) {
        prices[itemName] = cachedPrices[itemName.toLowerCase()];
        continue;
      }

      const { price, itemId } = await api.getItemPrice(itemName);
      prices[itemName] = price;

      // Cache the price
      if (price > 0) {
        await supabase.from('market_cache').upsert({
          item_name: itemName.toLowerCase(),
          item_id: itemId,
          price,
          cached_at: new Date().toISOString(),
        }, { onConflict: 'item_name' });
      }
    }

    // Calculate totals per member
    const members: ProcessedMember[] = memberNames.map(ign => {
      const data = parsed[ign];
      const donations = data.donations.map(d => ({
        item: d.item,
        quantity: d.quantity,
        price: prices[d.item] || 0,
        total: d.quantity * (prices[d.item] || 0),
      }));

      const totalGold = donations.reduce((sum, d) => sum + d.total, 0);

      return {
        ign,
        raids: data.raids,
        gold: totalGold,
        donations,
      };
    });

    // Sort by gold (highest first)
    members.sort((a, b) => b.gold - a.gold);

    return NextResponse.json({ members });
  } catch (error) {
    console.error('Parse error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to parse activity log' },
      { status: 500 }
    );
  }
}
