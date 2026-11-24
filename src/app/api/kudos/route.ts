import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { requireMember, isResponse } from '@/lib/user-auth';
import { giveKudos, giverStatus, memberIdByIgn } from '@/lib/kudos';

export const dynamic = 'force-dynamic';

/** GET /api/kudos — the signed-in member's giving status this week (remaining, given). */
export async function GET(req: NextRequest) {
  const user = await requireMember(req);
  if (isResponse(user)) return user;
  return NextResponse.json(await giverStatus(createAdminClient(), user.id));
}

/** POST /api/kudos { ign, reason } — give kudos to the account of that character. */
export async function POST(req: NextRequest) {
  const user = await requireMember(req);
  if (isResponse(user)) return user;
  const body = (await req.json().catch(() => ({}))) as { ign?: unknown; reason?: unknown };
  const supabase = createAdminClient();
  const target = typeof body.ign === 'string' ? await memberIdByIgn(supabase, body.ign) : null;
  if (!target) return NextResponse.json({ error: 'No Dream character with that name' }, { status: 404 });
  const res = await giveKudos(supabase, {
    giverUserId: user.id,
    recipientMemberId: target.id,
    reason: typeof body.reason === 'string' ? body.reason : '',
    source: 'web',
  });
  if (!res.ok) return NextResponse.json({ error: res.error.replace(/\*\*|`/g, '') }, { status: 400 });
  return NextResponse.json({ ok: true, remaining: res.remaining, kudos: res.kudos });
}
