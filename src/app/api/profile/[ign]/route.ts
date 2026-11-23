import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { requireMember, isResponse } from '@/lib/user-auth';
import { buildProfile, findProfileAccount, safeDecode } from '@/lib/profile';

export const dynamic = 'force-dynamic';

/** GET /api/profile/[ign] — members-only account profile for any character of the account. */
export async function GET(req: NextRequest, { params }: { params: { ign: string } }) {
  const user = await requireMember(req);
  if (isResponse(user)) return user;
  const supabase = createAdminClient();
  try {
    const account = await findProfileAccount(safeDecode(params.ign), supabase);
    if (!account) return NextResponse.json({ error: 'No Dream character with that name' }, { status: 404 });
    return NextResponse.json(await buildProfile(account, user.id, supabase));
  } catch (e) {
    console.error('[profile]', e);
    return NextResponse.json({ error: 'Failed to load profile' }, { status: 500 });
  }
}
