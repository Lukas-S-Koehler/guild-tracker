/**
 * Saving a character's /combat gear from outside /combat: the roster's leader editor and the
 * owner's editor on /assault/eligibility. One validation, one write path.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { GEAR_SLOTS, HAND_SLOT_CONFLICTS, MAX_TIER, type GearSelection } from '@/lib/combat/character-stats';

/** Known slots, one item per slot, item fits the slot, tier in range, no hand-slot clashes. */
export async function validateGear(
  supabase: SupabaseClient,
  input: GearSelection[]
): Promise<{ ok: true; gear: GearSelection[] } | { ok: false; error: string }> {
  const slots = new Set<string>(GEAR_SLOTS.map((s) => s.key));
  const ids = Array.from(new Set(input.map((g) => Number(g.gear_item_id))));
  const { data: items } = ids.length
    ? await supabase.from('gear_items').select('id, slot, quality, max_tier').in('id', ids)
    : { data: [] as { id: number; slot: string; quality: string; max_tier: number | null }[] };
  const itemById = new Map((items ?? []).map((i) => [i.id as number, i]));
  const gear: GearSelection[] = [];
  for (const g of input) {
    const item = itemById.get(Number(g.gear_item_id));
    if (!slots.has(g.slot) || !item || item.slot !== g.slot) return { ok: false, error: `Bad item for ${g.slot}` };
    if (gear.some((x) => x.slot === g.slot)) return { ok: false, error: `Two items in ${g.slot}` };
    const maxTier = item.max_tier ?? MAX_TIER[item.quality] ?? 16;
    const tier = Math.round(Number(g.tier));
    if (!(tier >= 1 && tier <= maxTier)) return { ok: false, error: `Tier for ${g.slot} must be 1–${maxTier}` };
    gear.push({ slot: g.slot, gear_item_id: item.id as number, tier });
  }
  for (const g of gear) {
    const clash = (HAND_SLOT_CONFLICTS[g.slot] ?? []).find((s) => gear.some((x) => x.slot === s));
    if (clash) return { ok: false, error: `${g.slot} can't be worn with ${clash}` };
  }
  return { ok: true, gear };
}

/**
 * Writes gear to the profile the roster and eligibility read (latest by hashed_id), or creates one
 * for the owner. Returns 'no-profile' when there is neither a profile nor an owner.
 * Empty gear sets `settings.noGear` ("saved, nothing equipped"), so it counts as set and battle is
 * measured without gear; an empty list without the flag still means "not picked yet".
 */
export async function writeProfileGear(
  supabase: SupabaseClient,
  t: { hashed_id: string; member_id: string | null; ign: string; owner: string | null },
  gear: GearSelection[]
): Promise<{ ok: true } | { ok: false; error: string } | { ok: false; error: 'no-profile' }> {
  const { data: profile } = await supabase
    .from('combat_profiles')
    .select('id, settings')
    .eq('hashed_id', t.hashed_id)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const now = new Date().toISOString();
  const withFlag = (settings: Record<string, unknown> | null) => {
    const { noGear: _old, ...rest } = settings ?? {};
    return gear.length ? rest : { ...rest, noGear: true };
  };
  if (profile) {
    const settings = withFlag(profile.settings as Record<string, unknown> | null);
    const { error } = await supabase.from('combat_profiles').update({ gear, settings, updated_at: now }).eq('id', profile.id);
    return error ? { ok: false, error: error.message } : { ok: true };
  }
  if (!t.owner) return { ok: false, error: 'no-profile' };
  const { error } = await supabase
    .from('combat_profiles')
    .insert({ user_id: t.owner, member_id: t.member_id, hashed_id: t.hashed_id, ign: t.ign, gear, settings: withFlag(null), updated_at: now });
  return error ? { ok: false, error: error.message } : { ok: true };
}
