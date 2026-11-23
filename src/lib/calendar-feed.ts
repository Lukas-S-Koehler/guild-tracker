/**
 * Personal calendar feed tokens (Dream Hub step 14). A calendar app can't send the site's login, so
 * the feed URL carries `u` (user id) + `t` (HMAC of it). The feed re-checks membership and the
 * user's guilds on every fetch, so leaving the guilds stops it. No expiry; the HMAC key derives
 * from the service role key, so rotating that key resets every feed.
 */
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { GUIDE_SITE_URL } from '@/lib/game-guide';

function key(): Buffer {
  const base = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base) throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured');
  return createHash('sha256').update(`calendar-feed:${base}`).digest();
}

const sign = (userId: string) => createHmac('sha256', key()).update(userId).digest('base64url');

export function feedUrl(userId: string): string {
  return `${GUIDE_SITE_URL}/api/calendar/ics?u=${encodeURIComponent(userId)}&t=${sign(userId)}`;
}

export function verifyFeed(userId: string | null, token: string | null): boolean {
  if (!userId || !token) return false;
  const expected = Buffer.from(sign(userId));
  const given = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
