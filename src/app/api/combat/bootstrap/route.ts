import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { requireUser, isResponse } from '@/lib/user-auth';
import { getAccountCharacters } from '@/lib/account-service';
import { PROFILE_COLUMNS, canCalibrateStats } from '@/lib/combat/profile-service';
import { ensureCustomPets } from '@/lib/combat/custom-pets-server';

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
  const [characters, { data: link }] = await Promise.all([
    getAccountCharacters(user.id, supabase),
    supabase.from('user_discord_links').select('discord_id').eq('user_id', user.id).maybeSingle(),
  ]);
  // Potion loadouts from /assault/potions (web) and /potions in Discord, so the Buffs card can
  // start from the user's real assault setup.
  const loadoutQ = supabase
    .from('assault_potion_loadouts')
    .select('id, name, is_default, combat_potion_ids, user_id, updated_at')
    .order('updated_at', { ascending: false });
  const [customPets, canCalibrate, loadouts, profiles, setups, gear, potions, enemies] = await Promise.all([
    ensureCustomPets(),
    canCalibrateStats(user.id, characters, supabase),
    link?.discord_id ? loadoutQ.or(`user_id.eq.${user.id},discord_user_id.eq.${link.discord_id}`) : loadoutQ.eq('user_id', user.id),
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

  return NextResponse.json({
    profiles: profiles.data ?? [],
    setups: setups.data ?? [],
    gear: gear.data ?? [],
    potions: potions.data ?? [],
    enemies: enemies.data ?? [],
    customPets,
    characters,
    canCalibrate,
    // Default first (web default beats Discord default, same as /me/assault), then most recent.
    loadouts: (loadouts.data ?? [])
      .map((l) => ({
        id: l.id as string,
        name: l.name as string,
        is_default: !!l.is_default,
        source: l.user_id === user.id ? 'web' : 'discord',
        combat_potion_ids: (l.combat_potion_ids ?? []) as number[],
      }))
      .sort((a, b) => Number(b.is_default) - Number(a.is_default) || Number(b.source === 'web') - Number(a.source === 'web')),
  });
}
