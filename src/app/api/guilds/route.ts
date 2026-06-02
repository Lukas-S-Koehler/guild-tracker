import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

// GET /api/guilds — public, no auth required
export async function GET(req: NextRequest) {
  const supabase = createAdminClient();

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
