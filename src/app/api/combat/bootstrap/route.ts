import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { requireUser, isResponse } from '@/lib/user-auth';
import { getAccountCharacters } from '@/lib/account-service';
import { PROFILE_COLUMNS } from '@/lib/combat/profile-service';

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
  const [profiles, setups, gear, potions, enemies] = await Promise.all([
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
    characters,
  });
}
