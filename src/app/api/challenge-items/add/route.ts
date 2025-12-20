import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { verifyAuth, isErrorResponse } from '@/lib/auth-helpers';

/**
 * POST /api/challenge-items/add
 * Add a single challenge item quantity
 * Used when activity log encounters missing items
 * Only accessible to OFFICER role and above
 */
export async function POST(req: NextRequest) {
  // Verify authentication (officers and leaders can add)
  const auth = await verifyAuth(req, 'OFFICER');
  if (isErrorResponse(auth)) return auth;

  const supabase = createServerClient(req);

  try {
    const body = await req.json();
    const { item_name, initial_quantity } = body;

    if (!item_name || typeof item_name !== 'string') {
      return NextResponse.json(
        { error: 'Item name is required' },
        { status: 400 }
      );
    }

    if (!initial_quantity || typeof initial_quantity !== 'number' || initial_quantity <= 0) {
      return NextResponse.json(
        { error: 'Initial quantity must be a positive number' },
        { status: 400 }
      );
    }

    // Insert or update item
    const { error: upsertError, data } = await supabase
      .from('challenge_item_quantities')
      .upsert(
        { item_name, initial_quantity },
        { onConflict: 'item_name' }
      )
      .select()
      .single();

    if (upsertError) {
      console.error('[Add] Upsert error:', upsertError);
      return NextResponse.json(
        { error: upsertError.message },
        { status: 500 }
      );
    }

    console.log(`[Add] Successfully added/updated item: ${item_name} (${initial_quantity})`);

    return NextResponse.json({
      success: true,
      data,
    });
  } catch (err: any) {
    console.error('[Add] Error:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to add item' },
      { status: 500 }
    );
  }
}
