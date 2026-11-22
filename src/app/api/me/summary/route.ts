import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { requireUser, isResponse } from '@/lib/user-auth';
import { buildMeSummary } from '@/lib/me-summary';

export const dynamic = 'force-dynamic';

/**
 * GET /api/me/summary[?guild_id=|?member_id=]
 * Personal dashboard for the signed-in user. Default = whole account.
 * guild_id = the user's characters in that Dream guild (one group, same rules as the
 * inactivity report); member_id = that character's group, or just the character when
 * it isn't in a Dream guild. Ids not on the user's account are ignored.
 */
export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;

  const params = new URL(req.url).searchParams;
  const memberId = params.get('member_id');
  const guildId = params.get('guild_id');
  try {
    const summary = await buildMeSummary(user.id, { memberId, guildId }, createAdminClient());
    return NextResponse.json(summary);
  } catch (e) {
    console.error('[me/summary]', e);
    return NextResponse.json({ error: 'Failed to build summary' }, { status: 500 });
  }
}
