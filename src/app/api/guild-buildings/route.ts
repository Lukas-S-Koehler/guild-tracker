import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { verifyAuth, isErrorResponse } from '@/lib/auth-helpers';

/**
 * GET /api/guild-buildings
 * Returns all available guild buildings with their resource requirements
 */
export async function GET(req: NextRequest) {
  // Verify authentication (members can view)
  const auth = await verifyAuth(req, 'MEMBER');
  if (isErrorResponse(auth)) return auth;

  const supabase = createServerClient(req);

  const { data: buildings, error } = await supabase
    .from('guild_buildings')
    .select('*')
    .order('display_order');

  if (error) {
    console.error('[Guild Buildings] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(buildings || []);
}
