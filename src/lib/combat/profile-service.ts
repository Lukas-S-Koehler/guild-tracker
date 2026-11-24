import { createAdminClient } from '@/lib/supabase-server';
import { IdleMMOApi } from '@/lib/idlemmo-api';
import { PET_STATS, resolveSpeciesName } from './pet-data';

const SUPER_ADMIN_USER_ID = '5f33bb41-86ab-4024-a1da-6a2fea5fb36b';
export const SYNC_COOLDOWN_MS = 2 * 60 * 1000;

export const PROFILE_COLUMNS =
  'id, user_id, member_id, hashed_id, ign, character_class, image_url, stats, skills, equipped_pet, pets, effects, location, gear, settings, is_active, last_sync, updated_at';

async function apiKeysFor(userId: string): Promise<{ own: string | null; fallback: string | null }> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('user_api_keys')
    .select('user_id, api_key')
    .in('user_id', [userId, SUPER_ADMIN_USER_ID]);
  const own = data?.find((r) => r.user_id === userId)?.api_key ?? null;
  const fallback = data?.find((r) => r.user_id === SUPER_ADMIN_USER_ID)?.api_key ?? null;
  return { own, fallback };
}

export const API_KEY_SETTINGS_URL = 'https://web.idle-mmo.com/settings/api';

const isAuthError = (e: unknown) => e instanceof Error && /API Error: (401|403)\b/.test(e.message);

/**
 * Pull info + effects + pets. Uses the user's own key; when they have none, or IdleMMO rejects it
 * (401/403: expired, revoked, missing scope), falls back to the super admin key. Pets are public
 * unless the owner hides them in game settings, so the fallback tries them too. `notice` tells the
 * user why something is missing and how to fix it.
 */
export async function fetchCharacterSnapshot(userId: string, hashedId: string) {
  const { own, fallback } = await apiKeysFor(userId);
  if (!own && !fallback) throw new Error('No IdleMMO API key available — add yours in /setup.');

  let usedFallback = !own;
  let ownKeyRejected = false;
  let api = new IdleMMOApi((own ?? fallback) as string);
  const load = () => Promise.all([api.getCharacterInformation(hashedId), api.getCharacterEffects(hashedId)]);

  let info: Awaited<ReturnType<IdleMMOApi['getCharacterInformation']>>;
  let effects: Awaited<ReturnType<IdleMMOApi['getCharacterEffects']>>;
  try {
    [info, effects] = await load();
  } catch (e) {
    if (!own || !fallback || !isAuthError(e)) throw e;
    ownKeyRejected = true;
    usedFallback = true;
    api = new IdleMMOApi(fallback);
    [info, effects] = await load();
  }

  let pets: Awaited<ReturnType<IdleMMOApi['getCharacterPets']>> = [];
  try {
    pets = await api.getCharacterPets(hashedId);
  } catch {
    pets = [];
  }
  const petsMissing = usedFallback && pets.length === 0;

  let notice: string | null = null;
  if (ownKeyRejected) {
    notice = `IdleMMO rejected your API key (expired or revoked), so a shared key was used${
      petsMissing ? ' and your pets could not be loaded' : ''
    }. Create a new key at ${API_KEY_SETTINGS_URL} and save it in /setup.`;
  } else if (petsMissing) {
    notice = `Your pets could not be loaded (they may be hidden in your game settings). Add your own API key from ${API_KEY_SETTINGS_URL} in /setup to sync them automatically.`;
  }

  // pet_id → species from non-renamed pets (resolves renamed equipped pets)
  const petIdToSpecies: Record<number, string> = {};
  for (const p of pets) if (!p.custom_name && PET_STATS[p.name]) petIdToSpecies[p.pet_id] = p.name;
  const speciesOf = (p: { pet_id: number; name: string; image_url: string | null }) =>
    petIdToSpecies[p.pet_id] ?? resolveSpeciesName(p.name, p.image_url) ?? null;

  const ep = info.equipped_pet;
  return {
    ign: info.name,
    character_class: info.class,
    image_url: info.image_url,
    stats: info.stats,
    skills: Object.fromEntries(Object.entries(info.skills ?? {}).map(([k, v]) => [k, { level: v.level, experience: v.experience }])),
    location: info.location,
    equipped_pet: ep
      ? {
          id: ep.id,
          pet_id: ep.pet_id,
          name: ep.custom_name ?? ep.name,
          species: speciesOf(ep),
          image_url: ep.image_url,
          level: ep.level,
          quality: ep.quality,
          evolution: ep.evolution?.state ?? 0,
        }
      : null,
    pets: pets.map((p) => ({
      id: p.id,
      name: p.custom_name ?? p.name,
      species: speciesOf(p),
      image_url: p.image_url,
      level: p.level,
      quality: p.quality,
      equipped: p.equipped,
      evolution: p.evolution?.state ?? 0,
    })),
    effects: effects.map((e) => ({
      source: e.source,
      target: e.target,
      attribute: e.attribute,
      value: e.value,
      value_type: e.value_type,
      enemy_id: e.enemy_id,
      location_id: e.location_id,
      expire_at: e.expire_at,
    })),
    pets_available: pets.length > 0,
    /** true when the shared key saw no pets: keep the pets already stored instead of wiping them */
    keep_stored_pets: petsMissing,
    notice,
  };
}

export async function syncProfile(userId: string, profileId: string, force = false) {
  const supabase = createAdminClient();
  const { data: profile } = await supabase
    .from('combat_profiles')
    .select('id, hashed_id, last_sync, skills')
    .eq('id', profileId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!profile) throw new Error('Profile not found');

  // Profiles from before the skills column always resync (combat level / pet mastery live there).
  if (!force && profile.skills && profile.last_sync && Date.now() - new Date(profile.last_sync).getTime() < SYNC_COOLDOWN_MS) {
    throw new Error('Synced recently — try again in a couple of minutes.');
  }

  const snap = await fetchCharacterSnapshot(userId, profile.hashed_id);
  const { pets_available: _ignored, keep_stored_pets, notice, pets, ...row } = snap;
  const { data, error } = await supabase
    .from('combat_profiles')
    .update({ ...row, ...(keep_stored_pets ? {} : { pets }), last_sync: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', profileId)
    .select(PROFILE_COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return { profile: data, notice };
}

/**
 * Stat calibration (manual sheet adjustments) is for assaulters only: the user must have a
 * character on their account that is currently in an assault guild (guilds.is_assault: DE, DI),
 * or be super admin.
 */
export async function canCalibrateStats(
  userId: string,
  characters: { guild_id: string | null; in_dream_guild: boolean }[],
  supabase = createAdminClient()
): Promise<boolean> {
  if (userId === SUPER_ADMIN_USER_ID) return true;
  const guildIds = characters.filter((c) => c.in_dream_guild && c.guild_id).map((c) => c.guild_id as string);
  if (!guildIds.length) return false;
  const { data } = await supabase.from('guilds').select('id').eq('is_assault', true).in('id', guildIds);
  return (data?.length ?? 0) > 0;
}
