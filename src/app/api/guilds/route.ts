import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { verifyAuth, isErrorResponse } from '@/lib/auth-helpers';

export async function GET(req: NextRequest) {
  // Verify authentication (any member can view guilds list)
  const authResult = await verifyAuth(req, 'MEMBER');
  if (isErrorResponse(authResult)) return authResult;

  const supabase = createServerClient(req);

  // Get all guilds ordered by display_order
  const { data: guilds, error } = await supabase
    .from('guilds')
    .select('*')
    .order('display_order', { ascending: true });

  if (error) {
    console.error('[Guilds API] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(guilds || []);
}
