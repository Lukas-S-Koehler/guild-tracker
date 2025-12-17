import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { verifyAuth, isErrorResponse } from '@/lib/auth-helpers';
import { IdleMMOApi } from '@/lib/idlemmo-api';
import { parseActivityLog, getUniqueItems } from '@/lib/parsers';
import type { ProcessedMember } from '@/types';

export async function POST(req: NextRequest) {
  // Verify authentication and get guild context
  const authResult = await verifyAuth(req);
  if (isErrorResponse(authResult)) return authResult;
  const { guildId } = authResult;

  const supabase = createServerClient(req);
  const body = await req.json();
  const { raw_log } = body;

  if (!raw_log || !raw_log.trim()) {
    return NextResponse.json({ error: 'Activity log is required' }, { status: 400 });
  }

  // Get API key for this guild
  const { data: config, error: configError } = await supabase
    .from('guild_config')
    .select('api_key')
    .eq('guild_id', guildId)
    .single();

  if (configError) {
    console.error('Error fetching guild_config:', configError);
    return NextResponse.json({ error: 'Failed to load configuration' }, { status: 500 });
  }

  if (!config?.api_key) {
    return NextResponse.json({ error: 'API key not configured. Go to Setup first.' }, { status: 400 });
  }

  try {
    // Parse the activity log into a map: { ign: { raids, donations: [{item,quantity}] } }
    const parsed = parseActivityLog(raw_log);
    const memberNames = Object.keys(parsed);

    if (memberNames.length === 0) {
      return NextResponse.json({ error: 'No valid activity found in log' }, { status: 400 });
    }

    // Get unique items that need price lookups (normalize to lowercase)
    const uniqueItemsRaw = getUniqueItems(parsed); // e.g., ['Yew Log', "Siren's Scales"]
    const uniqueItems = Array.from(new Set(uniqueItemsRaw.map((s: string) => s.toLowerCase())));

    // Prepare price map and check cache only if we have items
    const pricesByLower: Record<string, number> = {};

    if (uniqueItems.length > 0) {
      // Query cache for lowercase item names
      const { data: cached, error: cacheError } = await supabase
        .from('market_cache')
        .select('item_name, price')
        .in('item_name', uniqueItems);

      if (cacheError) {
        console.warn('market_cache query error:', cacheError);
      } else {
        cached?.forEach((c: any) => {
          if (c?.item_name) {
            pricesByLower[c.item_name.toLowerCase()] = c.price;
          }
        });
      }
    }

    // Fetch prices for items not in cache
    const api = new IdleMMOApi(config.api_key);

    for (const lowerName of uniqueItems) {
      if (pricesByLower[lowerName] !== undefined) continue;

      try {
        // Use the original-cased name for API if you have it; otherwise pass lowerName
        // Here we call API with the lowerName; adjust if your API expects original casing
        const { price, itemId } = await api.getItemPrice(lowerName);
        pricesByLower[lowerName] = price ?? 0;

        // Cache the price (store item_name lowercase)
        if (price > 0) {
          await supabase.from('market_cache').upsert({
            item_name: lowerName,
            item_id: itemId ?? null,
            price,
            cached_at: new Date().toISOString(),
          }, { onConflict: 'item_name' });
        }
      } catch (apiErr) {
        console.warn(`Price lookup failed for "${lowerName}":`, apiErr);
        pricesByLower[lowerName] = 0;
      }
    }

    // Calculate totals per member
    const members: ProcessedMember[] = memberNames.map(ign => {
      const data = parsed[ign];
      const donations = data.donations.map((d: { item: string; quantity: number }) => {
        const lower = d.item.toLowerCase();
        const price = pricesByLower[lower] ?? 0;
        const total = d.quantity * price;
        return {
          item: d.item,
          quantity: d.quantity,
          price,
          total,
        };
      });

      const totalGold = donations.reduce((sum: number, d: any) => sum + (d.total || 0), 0);

      return {
        ign,
        raids: data.raids || 0,
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
