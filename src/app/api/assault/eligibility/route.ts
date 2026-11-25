import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { requireUser, isResponse } from '@/lib/user-auth';
import { huntingBow } from '@/lib/combat/hunting-gear';
import { validateGear, writeProfileGear } from '@/lib/combat/gear-save';
import type { GearSelection } from '@/lib/combat/character-stats';
import {
  ELIGIBILITY_MANUAL_MIN_AGE_MS, expressInterest, ownEligibility, ownEligibilityTargets, syncEligibility,
} from '@/lib/assault-eligibility';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * GET /api/assault/eligibility
 * The viewer's claimed characters that aren't on an assault roster, measured against every assault
 * guild's goals. Snapshots older than 6 h refresh first (inside a budget); call again while
 * `sync.remaining` > 0.
 */
export async function GET(req: Request) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  const supabase = createAdminClient();
  const { rubrics, characters, sync } = await ownEligibility(user.id, supabase);
  const { data: prospects } = characters.length
    ? await supabase.from('recruit_prospects').select('ign, status, interest_guild_id, interest_at').in('ign', characters.map((c) => c.ign))
    : { data: [] };
  const interest = Object.fromEntries(
    (prospects ?? []).filter((p) => p.interest_at).map((p) => [String(p.ign).toLowerCase(), { guild_id: p.interest_guild_id, at: p.interest_at, status: p.status }])
  );
  return NextResponse.json({ rubrics, characters, sync, interest });
}

/**
 * POST /api/assault/eligibility
 * { hashed_id }                                  — refresh one of your characters now (2 min cooldown).
 * { action: 'interest', hashed_id, guild_id }    — "interested in joining": Recruiting prospect + leadership-chat note.
 * { action: 'bow', hashed_id, hunting_bow }       — set the hunting bow (members.hunting_bow, shared with /combat + roster).
 * { action: 'gear', hashed_id, gear }             — save gear (same /combat profile the roster reads). Works for characters
 *                                                  outside Dream too, who can't open /combat.
 */
export async function POST(req: Request) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  const body = (await req.json().catch(() => ({}))) as { action?: string; hashed_id?: string; guild_id?: string; hunting_bow?: string | null; gear?: GearSelection[] };
  if (!body.hashed_id) return NextResponse.json({ error: 'hashed_id required' }, { status: 400 });
  const supabase = createAdminClient();

  if (body.action === 'interest') {
    if (!body.guild_id) return NextResponse.json({ error: 'guild_id required' }, { status: 400 });
    const res = await expressInterest(user.id, body.hashed_id, body.guild_id, supabase);
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
    return NextResponse.json(res);
  }

  const target = (await ownEligibilityTargets(user.id, supabase)).find((t) => t.hashed_id === body.hashed_id);
  if (!target) return NextResponse.json({ error: 'Not one of your characters outside the assault guilds' }, { status: 403 });

  if (body.action === 'bow') {
    if (body.hunting_bow && !huntingBow(body.hunting_bow)) return NextResponse.json({ error: 'Unknown bow' }, { status: 400 });
    const { error } = await supabase
      .from('members')
      .update({ hunting_bow: body.hunting_bow ? huntingBow(body.hunting_bow)!.name : null })
      .eq('id', target.member_id as string);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  if (body.action === 'gear') {
    if (!Array.isArray(body.gear)) return NextResponse.json({ error: 'gear required' }, { status: 400 });
    const valid = await validateGear(supabase, body.gear);
    if (!valid.ok) return NextResponse.json({ error: valid.error }, { status: 400 });
    const saved = await writeProfileGear(
      supabase,
      { hashed_id: target.hashed_id, member_id: target.member_id, ign: target.ign, owner: user.id },
      valid.gear
    );
    if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  const result = await syncEligibility([target], { minAgeMs: ELIGIBILITY_MANUAL_MIN_AGE_MS, budgetMs: 60_000 }, supabase);
  if (!result.synced && !result.failed.length) {
    return NextResponse.json({ error: 'Refreshed a moment ago — try again in a couple of minutes.' }, { status: 429 });
  }
  return NextResponse.json(result);
}
