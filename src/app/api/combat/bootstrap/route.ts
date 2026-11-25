import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { requireUser, isResponse } from '@/lib/user-auth';
import { getAccountCharacters } from '@/lib/account-service';
import { PROFILE_COLUMNS, canCalibrateStats } from '@/lib/combat/profile-service';
import { ensureCustomPets } from '@/lib/combat/custom-pets-server';
import { listOwnerLoadouts, ownerForUser } from '@/lib/potions-service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/combat/bootstrap
 * Everything the /combat page needs in one call: the user's linked profiles,
 * saved setups, gear catalog, combat potions, enemies, and the user's account
 * characters (approved claims + alts). Requires at least one approved character.
 */
export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  const auth = { user };

  const supabase = createAdminClient();
  const characters = await getAccountCharacters(user.id, supabase);
  // Potion loadouts from /assault/potions (web) and /potions in Discord: one set per person
  // (see LoadoutOwner), so the Buffs card starts from the user's real assault setup.
  const loadoutQ = ownerForUser(user.id, supabase).then((o) => listOwnerLoadouts(o, supabase));
  const [customPets, canCalibrate, loadouts, profiles, setups, gear, potions, enemies] = await Promise.all([
    ensureCustomPets(),
    canCalibrateStats(user.id, characters, supabase),
    loadoutQ,
    supabase.from('combat_profiles').select(PROFILE_COLUMNS).eq('user_id', auth.user.id).order('created_at'),
    supabase
      .from('combat_setups')
      .select('*') // includes `pinned` once database/assault-personal.sql has run
      .eq('user_id', auth.user.id)
      .order('updated_at', { ascending: false }),
    supabase
      .from('gear_items')
      .select('id, name, slot, quality, agility, accuracy, protection, attack_power, critical_damage, combat_level, tier_modifiers, image_url, max_tier')
      .order('combat_level'),
    supabase
      .from('combat_potions')
      .select('id, name, quality, is_tradeable, attack_power_bonus, protection_bonus, duration_minutes, market_price, avg_recent_sales, image_url')
      .order('id'),
    supabase
      .from('combat_enemies')
      .select('id, name, level, zone_id, zone_name, health, experience, image_url')
      .order('zone_id')
      .order('level'),
  ]);

  const err = [profiles, setups, gear, potions, enemies].find((r) => r.error)?.error;
  if (err) return NextResponse.json({ error: err.message }, { status: 500 });

  // Hunting bow per character (members.hunting_bow, shared with /assault/roster).
  const memberIds = (profiles.data ?? []).map((p) => (p as { member_id: string | null }).member_id).filter(Boolean) as string[];
  const { data: bowRows } = memberIds.length
    ? await supabase.from('members').select('id, hunting_bow').in('id', memberIds)
    : { data: [] as { id: string; hunting_bow: string | null }[] };
  // Assaulters (a character in DE/DI) can take whole assault presets, XP slots included.
  const [presets, xpPotions] = canCalibrate
    ? await Promise.all([
        supabase.from('assault_potion_presets').select('id, label, combat_potion_ids, xp_potion_ids, assault_tier').order('sort_order'),
        supabase
          .from('xp_potions')
          .select('id, name, category, quality, effect_value, xp_value, efficiency_value, duration_minutes, description, image_url')
          .order('id'),
      ])
    : [{ data: [] }, { data: [] }];

  const huntingBows = Object.fromEntries((bowRows ?? []).map((m) => [m.id, m.hunting_bow ?? null]));

  return NextResponse.json({
    profiles: profiles.data ?? [],
    setups: setups.data ?? [],
    gear: gear.data ?? [],
    potions: potions.data ?? [],
    enemies: enemies.data ?? [],
    customPets,
    huntingBows,
    characters,
    canCalibrate,
    assaulter: canCalibrate,
    presets: presets.data ?? [],
    xpPotions: xpPotions.data ?? [],
    // Default first (web default beats Discord default, same as /me/assault), then most recent.
    loadouts: loadouts.map((l) => ({
      id: l.id,
      name: l.name,
      is_default: !!l.is_default,
      source: l.discord_user_id && !l.user_id ? 'discord' : 'web',
      combat_potion_ids: l.combat_potion_ids ?? [],
      xp_potion_ids: l.xp_potion_ids ?? [],
    })),
  });
}
