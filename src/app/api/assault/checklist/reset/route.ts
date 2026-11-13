import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-helpers';
import { resetChecklist, getLaunchDateForGuild } from '@/lib/assault-checklist-service';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req, 'MEMBER');
  if (auth instanceof NextResponse) return auth;

  const { user, guildId } = auth;
  const launchDate = await getLaunchDateForGuild(guildId);
  await resetChecklist(user.id, guildId, launchDate);
  return NextResponse.json({ ok: true, launch_date: launchDate });
}
