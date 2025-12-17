import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

export async function GET(req: NextRequest) {
  try {
    console.log('[TEST] Creating server client...');
    const supabase = createServerClient(req);

    console.log('[TEST] Getting user...');
    const { data: { user }, error } = await supabase.auth.getUser();

    console.log('[TEST] User:', user?.id, 'Error:', error?.message);

    return NextResponse.json({
      user: user?.id || null,
      error: error?.message || null,
      cookies: req.cookies.getAll().map(c => ({ name: c.name, hasValue: !!c.value }))
    });
  } catch (err: any) {
    console.error('[TEST] Exception:', err.message, err.stack);
    return NextResponse.json({ exception: err.message }, { status: 500 });
  }
}
