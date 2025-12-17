import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { verifyAuth, isErrorResponse } from '@/lib/auth-helpers';

export async function POST(req: NextRequest) {
  // Verify authentication (officers and leaders can save challenges)
  const auth = await verifyAuth(req, 'OFFICER');
  if (isErrorResponse(auth)) return auth;

  const supabase = createServerClient(req);

  try {
    const body = await req.json();
    const { raw_input, items, total_cost } = body;

    if (!raw_input || !items || !Array.isArray(items)) {
      return NextResponse.json(
        { error: 'Missing required challenge data' },
        { status: 400 }
      );
    }

    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    // Check if a challenge already exists for today
    const { data: existingChallenge } = await supabase
      .from('challenges')
      .select('*')
      .eq('guild_id', auth.guildId)
      .eq('challenge_date', today)
      .single();

    if (existingChallenge) {
      // Challenge exists for today - merge quantities (keep highest) and overwrite
      const existingItems = existingChallenge.items as any[];
      const itemMap = new Map<string, any>();

      // Add existing items to map
      existingItems.forEach(item => {
        const key = item.name.toLowerCase();
        itemMap.set(key, item);
      });

      // Merge with new items - keep highest quantity for each item
      items.forEach((newItem: any) => {
        const key = newItem.name.toLowerCase();
        const existing = itemMap.get(key);

        if (existing) {
          // Keep the highest quantity
          if (newItem.quantity > existing.quantity) {
            itemMap.set(key, {
              ...newItem,
              quantity: newItem.quantity, // Use new higher quantity
              price: newItem.price || existing.price, // Prefer new price
              total: newItem.quantity * (newItem.price || existing.price),
            });
          } else {
            // Keep existing higher quantity but update price if provided
            itemMap.set(key, {
              ...existing,
              price: newItem.price || existing.price, // Update price if new one provided
              total: existing.quantity * (newItem.price || existing.price),
            });
          }
        } else {
          // New item not in existing challenge
          itemMap.set(key, newItem);
        }
      });

      // Convert map back to array
      const mergedItems = Array.from(itemMap.values());
      const mergedTotalCost = mergedItems.reduce((sum, item) => sum + (item.total || 0), 0);

      // Update existing challenge with merged data
      const { error: updateError } = await supabase
        .from('challenges')
        .update({
          raw_input, // Update with latest raw input
          items: mergedItems,
          total_cost: mergedTotalCost,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingChallenge.id);

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 400 });
      }

      return NextResponse.json({
        success: true,
        message: 'Challenge updated with merged quantities',
        data: {
          ...existingChallenge,
          items: mergedItems,
          total_cost: mergedTotalCost,
        },
      });
    } else {
      // No challenge for today - create new one
      const { error: insertError, data } = await supabase
        .from('challenges')
        .insert({
          raw_input,
          items, // jsonb
          total_cost,
          guild_id: auth.guildId,
          challenge_date: today,
          is_completed: false,
        })
        .select();

      if (insertError) {
        return NextResponse.json({ error: insertError.message }, { status: 400 });
      }

      return NextResponse.json({ success: true, data });
    }
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to save challenge' },
      { status: 500 }
    );
  }
}
