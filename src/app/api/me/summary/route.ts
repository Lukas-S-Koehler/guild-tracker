import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { requireUser, isResponse } from '@/lib/user-auth';
import { buildMeSummary } from '@/lib/me-summary';

export const dynamic = 'force-dynamic';

/**
 * GET /api/me/summary?member_id=
 * Personal dashboard for the signed-in user. member_id picks a character from
 * the user's own account bundle (ignored if it isn't theirs); default = claimed main.
 */
export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;

  const memberId = new URL(req.url).searchParams.get('member_id');
  try {
    const summary = await buildMeSummary(user.id, memberId, createAdminClient());
    return NextResponse.json(summary);
  } catch (e) {
    console.error('[me/summary]', e);
    return NextResponse.json({ error: 'Failed to build summary' }, { status: 500 });
  }
}
