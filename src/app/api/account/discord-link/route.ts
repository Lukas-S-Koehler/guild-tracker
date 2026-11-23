import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { requireUser, isResponse } from '@/lib/user-auth';
import { getLinkByUser, linkDiscordToUser, unlinkDiscord, verifyLinkToken } from '@/lib/discord-link';

export const dynamic = 'force-dynamic';

/** GET /api/account/discord-link → the signed-in user's Discord link (or null). */
export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  return NextResponse.json({ link: await getLinkByUser(createAdminClient(), user.id) });
}

/** POST /api/account/discord-link { token } → link the Discord account from /claim; auto-claims on a staff mapping. */
export async function POST(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  const { token } = await req.json().catch(() => ({}));
  if (typeof token !== 'string') return NextResponse.json({ error: 'token required' }, { status: 400 });
  const v = verifyLinkToken(token);
  if ('error' in v) return NextResponse.json({ error: v.error }, { status: 400 });
  const res = await linkDiscordToUser(createAdminClient(), user.id, v.discordId, v.username);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 409 });
  return NextResponse.json({ ...res, discord_username: v.username });
}

/** DELETE /api/account/discord-link → unlink (characters' discord_id mapping stays; staff own that). */
export async function DELETE(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  await unlinkDiscord(createAdminClient(), user.id);
  return NextResponse.json({ ok: true });
}
