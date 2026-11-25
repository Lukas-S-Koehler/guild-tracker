import { createAdminClient } from '@/lib/supabase-server';
import { registerCustomPets, type CustomPet } from './custom-pets';

const TTL_MS = 5 * 60 * 1000;
let cache: { at: number; pets: CustomPet[] } | null = null;

/** Load admin-added pets (5 min cache) and register them into the pet tables. */
export async function ensureCustomPets(force = false): Promise<CustomPet[]> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.pets;
  const { data, error } = await createAdminClient().from('custom_pets').select('name, quality, stats');
  // Table missing (migration not run yet) → behave as if there are none.
  const pets = error ? [] : ((data ?? []) as CustomPet[]);
  registerCustomPets(pets);
  cache = { at: Date.now(), pets };
  return pets;
}
