import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { verifyAuth, isErrorResponse } from '@/lib/auth-helpers';

/**
 * GET /api/challenge-items/list
 * Get all challenge item quantities
 * Accessible to all authenticated users
 */
export async function GET(req: NextRequest) {
  // Verify authentication
  const auth = await verifyAuth(req);
  if (isErrorResponse(auth)) return auth;

  const supabase = createServerClient(req);

  try {
    const { data, error } = await supabase
      .from('challenge_item_quantities')
      .select('*')
      .order('item_name', { ascending: true });

    if (error) {
      console.error('[List] Error fetching items:', error);
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json(data || []);
  } catch (err: any) {
    console.error('[List] Error:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to fetch items' },
      { status: 500 }
    );
  }
}
