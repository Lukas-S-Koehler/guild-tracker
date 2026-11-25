import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { requireUser, isResponse } from '@/lib/user-auth';
import { getAllClaimLocks } from '@/lib/account-service';
import { GEAR_SLOTS, HAND_SLOT_CONFLICTS, MAX_TIER, type GearSelection } from '@/lib/combat/character-stats';
import { canLeaderEditMember } from '@/lib/assault-roster';
import { refreshRosterBoardSoon } from '@/lib/roster-discord';

export const dynamic = 'force-dynamic';

/** GET /api/assault/roster/gear: gear catalog for the leader gear editor. */
export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
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

  // Validate: known slots, one item per slot, item fits the slot, tier in range, no hand-slot clashes.
  const slots = new Set<string>(GEAR_SLOTS.map((s) => s.key));
  const ids = Array.from(new Set(body.gear.map((g) => Number(g.gear_item_id))));
  const { data: items } = ids.length
    ? await supabase.from('gear_items').select('id, slot, quality, max_tier').in('id', ids)
    : { data: [] as { id: number; slot: string; quality: string; max_tier: number | null }[] };
  const itemById = new Map((items ?? []).map((i) => [i.id as number, i]));
  const gear: GearSelection[] = [];
  for (const g of body.gear) {
    const item = itemById.get(Number(g.gear_item_id));
    if (!slots.has(g.slot) || !item || item.slot !== g.slot) return NextResponse.json({ error: `Bad item for ${g.slot}` }, { status: 400 });
    if (gear.some((x) => x.slot === g.slot)) return NextResponse.json({ error: `Two items in ${g.slot}` }, { status: 400 });
    const maxTier = item.max_tier ?? MAX_TIER[item.quality] ?? 16;
    const tier = Math.round(Number(g.tier));
    if (!(tier >= 1 && tier <= maxTier)) return NextResponse.json({ error: `Tier for ${g.slot} must be 1–${maxTier}` }, { status: 400 });
    gear.push({ slot: g.slot, gear_item_id: item.id as number, tier });
  }
  for (const g of gear) {
    const clash = (HAND_SLOT_CONFLICTS[g.slot] ?? []).find((s) => gear.some((x) => x.slot === s));
    if (clash) return NextResponse.json({ error: `${g.slot} can't be worn with ${clash}` }, { status: 400 });
  }

  // Same profile the roster reads (latest by hashed_id); otherwise create one for the owner.
  const { data: profile } = await supabase
    .from('combat_profiles')
    .select('id')
    .eq('hashed_id', row.hashed_id)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const now = new Date().toISOString();
  if (profile) {
    const { error } = await supabase.from('combat_profiles').update({ gear, updated_at: now }).eq('id', profile.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else if (owner) {
    const { error } = await supabase
      .from('combat_profiles')
      .insert({ user_id: owner, member_id: row.member_id, hashed_id: row.hashed_id, ign: row.ign, gear, updated_at: now });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    // Unclaimed: keep it on the roster; it seeds their /combat gear once they claim and open it.
    const { error } = await supabase.from('assault_roster').update({ staff_gear: gear }).eq('member_id', row.member_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  refreshRosterBoardSoon(row.guild_id);
  return NextResponse.json({ ok: true });
}
