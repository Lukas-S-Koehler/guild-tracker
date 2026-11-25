import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { requireUser, isResponse } from '@/lib/user-auth';
import { getAllClaimLocks } from '@/lib/account-service';
import type { GearSelection } from '@/lib/combat/character-stats';
import { validateGear, writeProfileGear } from '@/lib/combat/gear-save';
import { canLeaderEditMember } from '@/lib/assault-roster';
import { refreshRosterBoardSoon } from '@/lib/roster-discord';

export const dynamic = 'force-dynamic';

/** GET /api/assault/roster/gear: gear catalog for the gear editors (static game data, no sign-in needed). */
export async function GET() {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('gear_items')
    .select('id, name, slot, quality, combat_level, max_tier, image_url')
    .order('combat_level', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ catalog: data ?? [] });
}

/**
 * PATCH /api/assault/roster/gear { member_id, gear: [{slot, gear_item_id, tier}] }: replace the character's /combat gear.
 * No /combat profile and nobody claimed the character → stored on assault_roster.staff_gear instead.
 */
export async function PATCH(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  const body = (await req.json().catch(() => ({}))) as { member_id?: string; gear?: GearSelection[] };
  if (!body.member_id || !Array.isArray(body.gear)) return NextResponse.json({ error: 'member_id and gear required' }, { status: 400 });

  const supabase = createAdminClient();
  const { data: row } = await supabase
    .from('assault_roster')
    .select('member_id, guild_id, hashed_id, ign')
    .eq('member_id', body.member_id)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: 'Not on a roster' }, { status: 404 });

  const lock = (await getAllClaimLocks(supabase)).get(row.member_id);
  const owner = lock?.status === 'approved' ? lock.user_id : null;
  const auth = await canLeaderEditMember(supabase, user, row.guild_id, owner);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 403 });

  const valid = await validateGear(supabase, body.gear);
  if (!valid.ok) return NextResponse.json({ error: valid.error }, { status: 400 });
  const gear = valid.gear;

  // Same profile the roster reads (latest by hashed_id); otherwise create one for the owner.
  const saved = await writeProfileGear(supabase, { hashed_id: row.hashed_id, member_id: row.member_id, ign: row.ign, owner }, gear);
  if (!saved.ok && saved.error !== 'no-profile') return NextResponse.json({ error: saved.error }, { status: 500 });
  if (!saved.ok) {
    // Unclaimed: keep it on the roster; it seeds their /combat gear once they claim and open it.
    const { error } = await supabase.from('assault_roster').update({ staff_gear: gear }).eq('member_id', row.member_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  refreshRosterBoardSoon(row.guild_id);
  return NextResponse.json({ ok: true });
}
