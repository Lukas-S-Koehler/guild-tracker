import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-helpers';
import {
  getChecklistItems,
  getChecklistProgress,
  toggleChecklistItem,
  getLaunchDateForGuild,
} from '@/lib/assault-checklist-service';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req, 'MEMBER');
  if (auth instanceof NextResponse) return auth;

  const { user, guildId } = auth;
  const launchDate = await getLaunchDateForGuild(guildId);
  const [items, progress] = await Promise.all([
    getChecklistItems(guildId),
    getChecklistProgress(user.id, guildId, launchDate),
  ]);

  return NextResponse.json({ launch_date: launchDate, items, progress });
}

export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req, 'MEMBER');
  if (auth instanceof NextResponse) return auth;

  const { user, guildId } = auth;
  const body = (await req.json()) as { item_key: string; checked: boolean };
  if (!body?.item_key) {
    return NextResponse.json({ error: 'item_key required' }, { status: 400 });
  }
  const launchDate = await getLaunchDateForGuild(guildId);
  await toggleChecklistItem(user.id, guildId, launchDate, body.item_key, !!body.checked);
  return NextResponse.json({ ok: true, launch_date: launchDate });
}
