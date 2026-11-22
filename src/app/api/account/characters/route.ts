import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { getAccountCharacters } from '@/lib/account-service';
import { requireUser, isResponse } from '@/lib/user-auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/account/characters
 * The signed-in user's characters (approved claims + alts) and their claim requests.
 */
export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;

  const supabase = createAdminClient();
  const [characters, { data: claims }] = await Promise.all([
    getAccountCharacters(user.id, supabase),
    supabase
      .from('user_characters')
      .select('id, status, note, requested_at, reviewed_at, member:members(id, ign, avatar_url, current_guild_id)')
      .eq('user_id', user.id)
      .order('requested_at', { ascending: false }),
  ]);

  return NextResponse.json({ characters, claims: claims ?? [] });
}
