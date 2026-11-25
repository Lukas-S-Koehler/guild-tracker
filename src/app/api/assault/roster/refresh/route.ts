import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { requireUser, isResponse } from '@/lib/user-auth';
import { RANK, rankInGuild } from '@/lib/role-hierarchy';
import { getAllClaimLocks } from '@/lib/account-service';
import { assaultMembers, syncAssaultRoster } from '@/lib/assault-roster-sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Manual refreshes may re-read a character this soon after the last attempt. */
const MANUAL_MIN_AGE_MS = 2 * 60 * 1000;

/**
 * POST /api/assault/roster/refresh
 * Body: { member_id } — refresh one character (its owner, or staff of its guild).
 *       { guild_id }  — refresh a whole assault guild (officer+ of that guild, or super admin).
 *                       Runs inside the time budget; call again while `remaining` > 0.
 */
export async function POST(req: Request) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  const body = (await req.json().catch(() => ({}))) as { member_id?: string; guild_id?: string };
  const supabase = createAdminClient();

  if (body.member_id) {
    const target = (await assaultMembers(supabase)).find((m) => m.id === body.member_id);
    if (!target) return NextResponse.json({ error: 'Not a character in an assault guild' }, { status: 404 });
    const locks = await getAllClaimLocks(supabase);
    const lock = locks.get(target.id);
    const isOwner = lock?.status === 'approved' && lock.user_id === user.id;
    const rank = await rankInGuild(supabase, user, target.current_guild_id);
    if (!isOwner && rank < RANK.OFFICER) {
      return NextResponse.json({ error: 'Only the owner or guild staff can refresh this character' }, { status: 403 });
    }
    const result = await syncAssaultRoster({ memberIds: [target.id], minAgeMs: MANUAL_MIN_AGE_MS, budgetMs: 60_000 });
    if (!result.synced && !result.failed.length) {
      return NextResponse.json({ error: 'Refreshed a moment ago — try again in a couple of minutes.' }, { status: 429 });
    }
    return NextResponse.json(result);
  }

  if (body.guild_id) {
    const rank = await rankInGuild(supabase, user, body.guild_id);
    if (rank < RANK.OFFICER) return NextResponse.json({ error: 'Guild staff only' }, { status: 403 });
    const result = await syncAssaultRoster({ guildId: body.guild_id, minAgeMs: MANUAL_MIN_AGE_MS, budgetMs: 240_000 });
    return NextResponse.json(result);
  }

  return NextResponse.json({ error: 'member_id or guild_id required' }, { status: 400 });
}
