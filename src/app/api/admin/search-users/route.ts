import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { verifyAdminOrLeader, isErrorResponse } from '@/lib/auth-helpers';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/search-users?q=<prefix>
 * Returns display_name suggestions for admin add-user autocomplete.
 * Emails are never exposed.
 */
export async function GET(req: NextRequest) {
  const auth = await verifyAdminOrLeader(req);
  if (isErrorResponse(auth)) return auth;

  const supabase = createServerClient(req);
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get('q') ?? '').trim();

  const { data, error } = await supabase.rpc('search_users', {
    search_query: q,
    max_results: 20,
  });

  if (error) {
    console.error('[Admin] search_users RPC error:', error);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }

  const usernames = (data ?? [])
    .map((r: { display_name: string | null }) => r.display_name)
    .filter((n: string | null): n is string => !!n);

  return NextResponse.json({ usernames });
}
