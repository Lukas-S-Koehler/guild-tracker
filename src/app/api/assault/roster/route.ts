import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { requireUser, isResponse } from '@/lib/user-auth';
import { buildRoster, canLeaderEditMember, viewableRosterGuilds, PARTICIPATION, type Participation } from '@/lib/assault-roster';
import { getAllClaimLocks } from '@/lib/account-service';
import { huntingBow } from '@/lib/combat/hunting-gear';
import { mergeGoals } from '@/lib/roster-goals';
import { RSVP_STATUSES, nextWaveUnix, setRsvp, type RsvpStatus } from '@/lib/assault-rsvp';
import { refreshRosterBoardSoon } from '@/lib/roster-discord';
import { RANK, outranks, rankInGuild, ranksOf } from '@/lib/role-hierarchy';

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

  const [{ data: goalRow }, rank, { data: presets }] = await Promise.all([
    supabase.from('assault_roster_goals').select('goals').eq('guild_id', guild.id).maybeSingle(),
    rankInGuild(supabase, user, guild.id),
    supabase.from('assault_potion_presets').select('id, label, assault_tier').order('sort_order'),
  ]);

  // Rows a leader may edit (gear, provisional potions): owners ranked below them (hierarchy rule), unclaimed, or their own.
  let leaderEditable: string[] = [];
  if (rank >= RANK.LEADER) {
    const owners = Array.from(new Set(roster.rows.map((r) => r.owner_user_id).filter((id): id is string => !!id && id !== user.id)));
    const ownerRank = await ranksOf(supabase, owners, guild.id);
    leaderEditable = roster.rows
      .filter((r) => !r.owner_user_id || r.owner_user_id === user.id || outranks(rank, ownerRank.get(r.owner_user_id) ?? RANK.MEMBER))
      .map((r) => r.member_id);
  }

  return NextResponse.json({ guilds, guild, roster, mine, goals: mergeGoals(goalRow?.goals), canEditGoals: rank >= RANK.LEADER, leaderEditable, presets: presets ?? [] });
}

/**
 * PATCH /api/assault/roster { member_id, hunting_bow?, participation?, rsvp?, provisional_preset? }
 * hunting_bow: owner or guild staff.
 * participation: the owner picks their own default (auto / opt_in / none); guild staff too (user rule 2026-11-25).
 * rsvp: answer for the next wave ('in' | 'maybe' | 'out', null = clear). Owner or guild staff. Works for
 *   every default: a 'none' character answering 'in' is counted for that wave only.
 * provisional_preset: potion preset used until the owner saves their own loadout (null = Mid). Leaders only.
 */
export async function PATCH(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  const body = (await req.json().catch(() => ({}))) as {
    member_id?: string; hunting_bow?: string | null; participation?: Participation; rsvp?: RsvpStatus | null; provisional_preset?: string | null;
  };
  if (!body.member_id) return NextResponse.json({ error: 'member_id required' }, { status: 400 });

  const supabase = createAdminClient();
  const { data: row } = await supabase.from('assault_roster').select('member_id, guild_id, participation').eq('member_id', body.member_id).maybeSingle();
  if (!row) return NextResponse.json({ error: 'Not on a roster' }, { status: 404 });

  const guilds = await viewableRosterGuilds(user, supabase);
  const isStaff = !!guilds.find((g) => g.id === row.guild_id)?.isStaff;
  const lock = (await getAllClaimLocks(supabase)).get(row.member_id);
  const isOwner = lock?.status === 'approved' && lock.user_id === user.id;

  if (body.rsvp !== undefined) {
    if (!isOwner && !isStaff) return NextResponse.json({ error: 'Only the owner or guild staff can answer for this character' }, { status: 403 });
    if (body.rsvp !== null && !RSVP_STATUSES.includes(body.rsvp)) return NextResponse.json({ error: 'Unknown answer' }, { status: 400 });
    const wave = await nextWaveUnix(row.guild_id);
    if (!wave) return NextResponse.json({ error: 'No upcoming wave scheduled' }, { status: 400 });
    await setRsvp({ guildId: row.guild_id, waveUnix: wave, memberIds: [row.member_id], status: body.rsvp, source: 'web', userId: user.id }, supabase);
    refreshRosterBoardSoon(row.guild_id);
    return NextResponse.json({ ok: true });
  }

  if (body.provisional_preset !== undefined) {
    const auth = await canLeaderEditMember(supabase, user, row.guild_id, lock?.status === 'approved' ? lock.user_id : null);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 403 });
    if (body.provisional_preset) {
      const { data: preset } = await supabase.from('assault_potion_presets').select('id').eq('id', body.provisional_preset).maybeSingle();
      if (!preset) return NextResponse.json({ error: 'Unknown preset' }, { status: 400 });
    }
    const { error } = await supabase
      .from('assault_roster')
      .update({ provisional_preset: body.provisional_preset || null, provisional_by: user.id })
      .eq('member_id', row.member_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    refreshRosterBoardSoon(row.guild_id);
    return NextResponse.json({ ok: true });
  }

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
    if (!isOwner && !isStaff) return NextResponse.json({ error: 'Only the owner or guild staff can change this' }, { status: 403 });
    update.participation = body.participation;
    update.participation_by = user.id;
  }
  if (!Object.keys(update).length) return NextResponse.json({ error: 'Nothing to change' }, { status: 400 });

  const { error } = await supabase.from('assault_roster').update(update).eq('member_id', row.member_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (update.participation) refreshRosterBoardSoon(row.guild_id);
  return NextResponse.json({ ok: true });
}
