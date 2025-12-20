import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { verifyAuth, isErrorResponse } from '@/lib/auth-helpers';

/**
 * POST /api/challenge-items/import
 * Import challenge item quantities from CSV
 * CSV format: item_name,initial_quantity
 * Only accessible to OFFICER role and above
 */
export async function POST(req: NextRequest) {
  // Verify authentication (officers and leaders can import)
  const auth = await verifyAuth(req, 'OFFICER');
  if (isErrorResponse(auth)) return auth;

  const supabase = createServerClient(req);

  try {
    const body = await req.json();
    const { csv_data } = body;

    if (!csv_data || typeof csv_data !== 'string') {
      return NextResponse.json(
        { error: 'CSV data is required' },
        { status: 400 }
      );
    }

    // Parse CSV data
    const lines = csv_data.trim().split('\n');
    const items: Array<{ item_name: string; initial_quantity: number }> = [];
    const skipped: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Skip header row if it exists
      if (i === 0 && (line.toLowerCase().includes('item') || line.toLowerCase().includes('quantity'))) {
        continue;
      }

      // Split by comma
      const parts = line.split(',').map(p => p.trim());
      if (parts.length < 2) {
        skipped.push(line);
        continue;
      }

      const [itemName, quantityStr] = parts;

      // Skip empty quantities or those marked with —
      if (!quantityStr || quantityStr === '—' || quantityStr === '-' || quantityStr === '') {
        skipped.push(itemName);
        continue;
      }

      // Parse quantity
      const quantity = parseInt(quantityStr, 10);
      if (isNaN(quantity) || quantity <= 0) {
        skipped.push(itemName);
        continue;
      }

      items.push({
        item_name: itemName,
        initial_quantity: quantity,
      });
    }

    if (items.length === 0) {
      return NextResponse.json(
        { error: 'No valid items found in CSV', skipped },
        { status: 400 }
      );
    }

    // Upsert items into database
    const { error: upsertError } = await supabase
      .from('challenge_item_quantities')
      .upsert(items, { onConflict: 'item_name' });

    if (upsertError) {
      console.error('[Import] Upsert error:', upsertError);
      return NextResponse.json(
        { error: upsertError.message },
        { status: 500 }
      );
    }

    console.log(`[Import] Successfully imported ${items.length} items, skipped ${skipped.length}`);

    return NextResponse.json({
      success: true,
      imported: items.length,
      skipped: skipped.length,
      skipped_items: skipped,
    });
  } catch (err: any) {
    console.error('[Import] Error:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to import CSV' },
      { status: 500 }
    );
  }
}
