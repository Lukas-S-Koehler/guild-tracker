import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { requireUser, isResponse } from '@/lib/user-auth';
import { buildRoster, viewableRosterGuilds, PARTICIPATION, type Participation } from '@/lib/assault-roster';
import { getAllClaimLocks } from '@/lib/account-service';
import { huntingBow } from '@/lib/combat/hunting-gear';
import { mergeGoals } from '@/lib/roster-goals';
import { RANK, rankInGuild } from '@/lib/role-hierarchy';

export const dynamic = 'force-dynamic';

/**
 * GET /api/assault/roster?guild=<id>&zone=<location id 1-10, default: the guild's tracked assault zone>
 * Assault guilds the viewer can see + the roster of one of them (default: the first).
 * Everyone in an assault guild sees that guild's whole roster; staff + super admin too.
 */
export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  const supabase = createAdminClient();
  const guilds = await viewableRosterGuilds(user, supabase);
  if (!guilds.length) return NextResponse.json({ error: 'The roster is for assault guild members' }, { status: 403 });

  const wanted = req.nextUrl.searchParams.get('guild');
  const guild = guilds.find((g) => g.id === wanted) ?? guilds[0];
  const zone = Number(req.nextUrl.searchParams.get('zone')) || null;
  const roster = await buildRoster(guild.id, supabase, zone);
  if (!roster) return NextResponse.json({ error: 'Not an assault guild' }, { status: 404 });

  // Rows the viewer may edit the hunting bow on: their own account's characters (or all, for staff).
  const locks = await getAllClaimLocks(supabase);
  const mine = roster.rows
    .filter((r) => {
      const l = locks.get(r.member_id);
      return l?.status === 'approved' && l.user_id === user.id;
    })
    .map((r) => r.member_id);

  const [{ data: goalRow }, rank] = await Promise.all([
    supabase.from('assault_roster_goals').select('goals').eq('guild_id', guild.id).maybeSingle(),
    rankInGuild(supabase, user, guild.id),
  ]);

  return NextResponse.json({ guilds, guild, roster, mine, goals: mergeGoals(goalRow?.goals), canEditGoals: rank >= RANK.LEADER });
}

/**
 * PATCH /api/assault/roster { member_id, hunting_bow?, participation? }
 * hunting_bow: owner or guild staff.
 * participation: owner may switch auto ↔ opt_in; only staff set or clear 'none' (user rule).
 */
export async function PATCH(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  const body = (await req.json().catch(() => ({}))) as { member_id?: string; hunting_bow?: string | null; participation?: Participation };
  if (!body.member_id) return NextResponse.json({ error: 'member_id required' }, { status: 400 });

  const supabase = createAdminClient();
  const { data: row } = await supabase.from('assault_roster').select('member_id, guild_id, participation').eq('member_id', body.member_id).maybeSingle();
  if (!row) return NextResponse.json({ error: 'Not on a roster' }, { status: 404 });

  const guilds = await viewableRosterGuilds(user, supabase);
  const isStaff = !!guilds.find((g) => g.id === row.guild_id)?.isStaff;
  const lock = (await getAllClaimLocks(supabase)).get(row.member_id);
  const isOwner = lock?.status === 'approved' && lock.user_id === user.id;

  const update: Record<string, unknown> = {};
  if (body.hunting_bow !== undefined) {
    if (!isOwner && !isStaff) return NextResponse.json({ error: 'Only the owner or guild staff can set the bow' }, { status: 403 });
    if (body.hunting_bow && !huntingBow(body.hunting_bow)) return NextResponse.json({ error: 'Unknown bow' }, { status: 400 });
    // Stored on the character, shared with /combat.
    const { error: bowErr } = await supabase
      .from('members')
      .update({ hunting_bow: body.hunting_bow ? huntingBow(body.hunting_bow)!.name : null })
      .eq('id', row.member_id);
    if (bowErr) return NextResponse.json({ error: bowErr.message }, { status: 500 });
    if (body.participation === undefined) return NextResponse.json({ ok: true });
  }
  if (body.participation !== undefined) {
    if (!PARTICIPATION.includes(body.participation)) return NextResponse.json({ error: 'Unknown participation' }, { status: 400 });
    const touchesNone = body.participation === 'none' || row.participation === 'none';
    if (touchesNone ? !isStaff : !isOwner && !isStaff) {
      return NextResponse.json(
        { error: touchesNone ? 'Only guild staff mark someone as not assaulting' : 'Only the owner or guild staff can change this' },
        { status: 403 }
      );
    }
    update.participation = body.participation;
    update.participation_by = user.id;
  }
  if (!Object.keys(update).length) return NextResponse.json({ error: 'Nothing to change' }, { status: 400 });

  const { error } = await supabase.from('assault_roster').update(update).eq('member_id', row.member_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
