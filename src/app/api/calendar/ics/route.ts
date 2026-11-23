import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { buildCalendar, forGuilds, toIcs } from '@/lib/calendar';
import { verifyFeed } from '@/lib/calendar-feed';
import { getAccountCharacters } from '@/lib/account-service';
import { GUIDE_SITE_URL } from '@/lib/game-guide';

export const dynamic = 'force-dynamic';

/**
 * GET /api/calendar/ics?u=<user id>&t=<token> — personal iCalendar feed (next 6 weeks):
 * network-wide events plus the user's own guilds. Subscribe in Google / Apple / Outlook calendar.
 */
export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  const userId = sp.get('u');
  if (!verifyFeed(userId, sp.get('t'))) return new NextResponse('Invalid calendar link', { status: 403 });
  const supabase = createAdminClient();
  const chars = await getAccountCharacters(userId!, supabase);
  const guildIds = new Set(chars.filter((c) => c.in_dream_guild && c.guild_id).map((c) => c.guild_id as string));
  const events = guildIds.size ? forGuilds(await buildCalendar(supabase, { from: new Date(Date.now() - 86_400_000), days: 43 }), guildIds) : [];
  return new NextResponse(toIcs(events, 'Dream Guilds', GUIDE_SITE_URL), {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="dream-guilds.ics"',
      'Cache-Control': 'private, max-age=3600',
    },
  });
}
