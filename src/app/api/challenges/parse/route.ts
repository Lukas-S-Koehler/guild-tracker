import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { verifyAuth, isErrorResponse } from '@/lib/auth-helpers';
import { IdleMMOApi } from '@/lib/idlemmo-api';
import { parseChallengeData } from '@/lib/parsers';
import { getMemberApiKey } from '@/lib/member-api-key';

export async function POST(req: NextRequest) {
  // Verify authentication and get guild context
  const authResult = await verifyAuth(req);
  if (isErrorResponse(authResult)) return authResult;
  const { guildId, user } = authResult;

  const supabase = createServerClient(req);
  const body = await req.json();

  const { raw_input } = body;

  if (!raw_input || !raw_input.trim()) {
    return NextResponse.json({ error: 'Challenge data is required' }, { status: 400 });
  }

  // Get API key for this member
  const apiKey = await getMemberApiKey(supabase, user.id, guildId);

  if (!apiKey) {
    return NextResponse.json({
      error: 'API key not configured. Go to Settings to add your IdleMMO API key.'
    }, { status: 400 });
  }

  try {
    // Parse challenge data
    const parsed = parseChallengeData(raw_input);

    if (parsed.length === 0) {
      return NextResponse.json({ 
        error: 'No valid items found. Expected format: quantity on one line, item name on next.' 
      }, { status: 400 });
    }

    // Get unique item names
    const itemNames = parsed.map(p => p.name);

    // Check cache first - only use cache entries from last 24 hours
    const twentyFourHoursAgo = new Date();
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

    const { data: cached } = await supabase
      .from('market_cache')
      .select('item_name, price, cached_at')
      .in('item_name', itemNames.map(i => i.toLowerCase()))
      .gte('cached_at', twentyFourHoursAgo.toISOString());

    const cachedPrices: Record<string, number> = {};
    cached?.forEach(c => {
      cachedPrices[c.item_name.toLowerCase()] = c.price;
    });

    // Fetch prices
    const api = new IdleMMOApi(apiKey);
    const items = [];

    for (const item of parsed) {
      let price = cachedPrices[item.name.toLowerCase()];

      if (price === undefined) {
        const result = await api.getItemPrice(item.name);
        price = result.price;

        // Cache the price
        if (price > 0) {
          await supabase.from('market_cache').upsert({
            item_name: item.name.toLowerCase(),
            item_id: result.itemId,
            price,
            cached_at: new Date().toISOString(),
          }, { onConflict: 'item_name' });
        }
      }

      const total = item.quantity * price;

      items.push({
        name: item.name,
        quantity: item.quantity,
        price,
        total,
        isExpensive: total > 15000,
      });
    }

    return NextResponse.json({ items });
  } catch (error) {
    console.error('Parse error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to parse challenge data' },
      { status: 500 }
    );
  }
}
