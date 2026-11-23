import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { requireMember, isResponse } from '@/lib/user-auth';
import { buildCalendar } from '@/lib/calendar';
import { getAccountCharacters } from '@/lib/account-service';
import { feedUrl } from '@/lib/calendar-feed';

export const dynamic = 'force-dynamic';

/** GET /api/calendar?days=14 — upcoming events (members only) + the viewer's guilds + feed URL. */
export async function GET(req: NextRequest) {
  const user = await requireMember(req);
  if (isResponse(user)) return user;
  const days = Math.min(42, Math.max(1, Number(new URL(req.url).searchParams.get('days')) || 14));
  const supabase = createAdminClient();
  try {
    const [events, chars] = await Promise.all([buildCalendar(supabase, { days }), getAccountCharacters(user.id, supabase)]);
    const myGuildIds = Array.from(new Set(chars.filter((c) => c.in_dream_guild && c.guild_id).map((c) => c.guild_id as string)));
    return NextResponse.json({ events, my_guild_ids: myGuildIds, feed_url: feedUrl(user.id) });
  } catch (e) {
    console.error('[calendar]', e);
    return NextResponse.json({ error: 'Failed to build calendar' }, { status: 500 });
  }
}
