import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { verifyAuth, isErrorResponse } from '@/lib/auth-helpers';
import { IdleMMOApi } from '@/lib/idlemmo-api';
import { parseActivityLog, getUniqueItems } from '@/lib/parsers';
import { getMemberApiKey } from '@/lib/member-api-key';
import type { ProcessedMember } from '@/types';

export async function POST(req: NextRequest) {
  // Verify authentication and get guild context
  const authResult = await verifyAuth(req);
  if (isErrorResponse(authResult)) return authResult;
  const { guildId, user } = authResult;

  const supabase = createServerClient(req);
  const body = await req.json();
  const { raw_log } = body;

  if (!raw_log || !raw_log.trim()) {
    return NextResponse.json({ error: 'Activity log is required' }, { status: 400 });
  }

  // Get API key for this member
  const apiKey = await getMemberApiKey(supabase, user.id, guildId);

  if (!apiKey) {
    return NextResponse.json({
      error: 'API key not configured. Go to Settings to add your IdleMMO API key.'
    }, { status: 400 });
  }

  // Fetch guild config to check settings
  const { data: config } = await supabase
    .from('guild_config')
    .select('settings')
    .eq('guild_id', guildId)
    .single();

  const allowChallengeQtyRequirement = config?.settings?.allow_challenge_quantity_requirement || false;
  const activeBuildings = config?.settings?.active_buildings || [];

  // Fetch valid deposit items from active buildings
  const validDepositItems = new Set<string>();
  if (activeBuildings.length > 0) {
    const { data: buildings } = await supabase
      .from('guild_buildings')
      .select('id, name, resources')
      .in('id', activeBuildings);

    if (buildings) {
      buildings.forEach((building: any) => {
        if (building.resources && Array.isArray(building.resources)) {
          building.resources.forEach((resource: any) => {
            if (resource.item) {
              validDepositItems.add(resource.item.toLowerCase());
            }
          });
        }
      });
    }
  }

  console.log(`[Parse] Guild ${guildId}: active buildings=${activeBuildings.join(',')}, valid deposit items=${Array.from(validDepositItems).join(',')}`);


  try {
    // Parse the activity log into a map: { ign: { raids, donations: [{item,quantity}] } }
    const parseResult = parseActivityLog(raw_log);
    const { members: parsed, memberStatusChanges } = parseResult;
    const memberNames = Object.keys(parsed);

    if (memberNames.length === 0 && memberStatusChanges.length === 0) {
      return NextResponse.json({ error: 'No valid activity found in log' }, { status: 400 });
    }

    // Get unique items that need price lookups (normalize to lowercase)
    const uniqueItemsRaw = getUniqueItems(parseResult); // e.g., ['Yew Log', "Siren's Scales"]
    const uniqueItems = Array.from(new Set(uniqueItemsRaw.map((s: string) => s.toLowerCase())));

    // Check which items are missing from challenge_item_quantities
    let missingItems: string[] = [];
    if (uniqueItems.length > 0) {
      // Fetch ALL items from DB (only ~100 items, so this is efficient)
      // We need to do case-insensitive comparison since DB stores proper casing
      const { data: allDbItems, error: checkError } = await supabase
        .from('challenge_item_quantities')
        .select('item_name');

      if (checkError) {
        console.warn('Error checking challenge items:', checkError);
      } else {
        // Create a Set of lowercase item names from the database
        const existingItemsSet = new Set(
          allDbItems?.map((item: any) => item.item_name.toLowerCase()) || []
        );

        // Find items from activity log that don't exist in DB (case-insensitive)
        missingItems = uniqueItems.filter(item => !existingItemsSet.has(item.toLowerCase()));

        // If there are missing items, return them for user to add
        if (missingItems.length > 0) {
          console.log('[Parse] Missing challenge items:', missingItems);
          // Map back to original casing
          const missingItemsOriginal = uniqueItemsRaw.filter(item =>
            missingItems.includes(item.toLowerCase())
          );
          return NextResponse.json({
            error: 'Missing challenge item quantities',
            missing_items: missingItemsOriginal,
          }, { status: 400 });
        }
      }
    }

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
    const api = new IdleMMOApi(apiKey);

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

    // Fetch challenge item quantities for percentage calculations
    let itemQuantitiesMap = new Map<string, number>();
    if (uniqueItems.length > 0) {
      const { data: allDbItems } = await supabase
        .from('challenge_item_quantities')
        .select('item_name, initial_quantity');

      if (allDbItems && allDbItems.length > 0) {
        allDbItems.forEach((item: any) => {
          itemQuantitiesMap.set(item.item_name.toLowerCase(), item.initial_quantity);
        });
      }
    }

    // Calculate totals per member
    const members: ProcessedMember[] = memberNames.map((ign, index) => {
      const data = parsed[ign];
      const donations = data.donations.map((d: { item: string; quantity: number }) => {
        const lower = d.item.toLowerCase();
        const price = pricesByLower[lower] ?? 0;
        const total = d.quantity * price;
        const initialQty = itemQuantitiesMap.get(lower) || 0;
        const percentageOfInitial = initialQty > 0
          ? Math.round((d.quantity / initialQty) * 100)
          : 0;

        return {
          item: d.item,
          quantity: d.quantity,
          price,
          total,
          initial_quantity: initialQty,
          percentage_of_initial: percentageOfInitial,
        };
      });

      const totalGold = donations.reduce((sum: number, d: any) => sum + (d.total || 0), 0);

      // Process deposits (guild hall)
      // Only count deposits of items that are in the active buildings' resource lists
      const deposits = data.deposits.map((d: { item: string; quantity: number }) => {
        const lower = d.item.toLowerCase();
        const price = pricesByLower[lower] ?? 0;
        const total = d.quantity * price;
        const isValid = validDepositItems.size === 0 || validDepositItems.has(lower);

        return {
          item: d.item,
          quantity: d.quantity,
          price,
          total,
          valid: isValid,
        };
      });

      // Only sum gold from valid deposits
      const totalDepositsGold = deposits
        .filter((d: any) => d.valid)
        .reduce((sum: number, d: any) => sum + (d.total || 0), 0);

      // Check if any item donation meets 50% of initial quantity
      // Only count this if the guild has the toggle enabled
      const metsChallengeByQuantity = allowChallengeQtyRequirement && donations.some((d: any) =>
        d.initial_quantity > 0 && d.quantity >= (d.initial_quantity / 2)
      );

      console.log(`[Parse] ${ign}: allowChallengeQty=${allowChallengeQtyRequirement}, metsChallengeByQuantity=${metsChallengeByQuantity}, donations:`, donations.map((d: any) => `${d.item}(${d.quantity}/${d.initial_quantity}, ${d.percentage_of_initial}%)`));

      return {
        ign,
        raids: data.raids || 0,
        gold: totalGold,
        deposits_gold: totalDepositsGold,
        donations,
        deposits,
        meets_challenge_quantity: metsChallengeByQuantity,
        log_order: index, // Preserve chronological order from Discord log (0 = first/most recent)
      };
    });

    // Sort by total gold (challenge donations + deposits) - highest first for display, but preserve log_order
    members.sort((a, b) => {
      const totalA = a.gold + (a.deposits_gold || 0);
      const totalB = b.gold + (b.deposits_gold || 0);
      return totalB - totalA;
    });

    return NextResponse.json({
      members,
      memberStatusChanges: memberStatusChanges.length > 0 ? memberStatusChanges : undefined,
    });
  } catch (error) {
    console.error('Parse error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to parse activity log' },
      { status: 500 }
    );
  }
}
