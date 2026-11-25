import { createAdminClient, createServerClient } from '@/lib/supabase-server';
import type { CombatPotion, Loadout, XpPotion } from '@/lib/potion-rules';

export interface Preset {
  id: string;
  label: string;
  description: string | null;
  sort_order: number;
  combat_potion_ids: number[];
  xp_potion_ids: number[];
  /** Assault Roster tier: 0 none, 1 Bronze … 5 Dream. */
  assault_tier?: number;
}

export interface SavedLoadout extends Loadout {
  id: string;
  user_id: string;
  name: string;
  is_default: boolean;
  discord_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export async function listPotions() {
  const supabase = createAdminClient();
  const [{ data: combat }, { data: xp }, { data: presets }] = await Promise.all([
    supabase.from('combat_potions').select('*').order('id'),
    supabase.from('xp_potions').select('*').order('id'),
    supabase.from('assault_potion_presets').select('*').order('sort_order'),
  ]);
  return {
    combat: (combat ?? []) as CombatPotion[],
    xp: (xp ?? []) as XpPotion[],
    presets: (presets ?? []) as Preset[],
  };
}

/**
 * One person = one set of loadouts, whether saved on the web (user_id) or with /potions in
 * Discord (discord_user_id). When the Discord account is linked (user_discord_links) both keys
 * point at the same owner, so web and Discord see, edit and default the same loadouts.
 */
export interface LoadoutOwner {
  userId: string | null;
  discordId: string | null;
}

type Admin = ReturnType<typeof createAdminClient>;

export async function ownerForUser(userId: string, supabase: Admin = createAdminClient()): Promise<LoadoutOwner> {
  const { data } = await supabase.from('user_discord_links').select('discord_id').eq('user_id', userId).maybeSingle();
  return { userId, discordId: (data?.discord_id as string | undefined) ?? null };
}

export async function ownerForDiscord(discordId: string, supabase: Admin = createAdminClient()): Promise<LoadoutOwner> {
  const { data } = await supabase.from('user_discord_links').select('user_id').eq('discord_id', discordId).maybeSingle();
  return { userId: (data?.user_id as string | undefined) ?? null, discordId };
}

/** PostgREST filter matching every loadout of this owner (web or Discord). */
export function ownerFilter(o: LoadoutOwner): string {
  return [o.userId && `user_id.eq.${o.userId}`, o.discordId && `discord_user_id.eq.${o.discordId}`].filter(Boolean).join(',');
}

export async function listOwnerLoadouts(o: LoadoutOwner, supabase: Admin = createAdminClient()): Promise<SavedLoadout[]> {
  const { data } = await supabase
    .from('assault_potion_loadouts')
    .select('*')
    .or(ownerFilter(o))
    .order('is_default', { ascending: false })
    .order('updated_at', { ascending: false });
  // Before this was unified, web and Discord each kept a default: only the newest one counts.
  const rows = (data ?? []) as SavedLoadout[];
  let seen = false;
  return rows.map((r) => {
    if (!r.is_default) return r;
    if (seen) return { ...r, is_default: false };
    seen = true;
    return r;
  });
}

/** Make one loadout the default; clears the default on every loadout of the owner (web + Discord). */
export async function setOwnerDefault(o: LoadoutOwner, loadoutId: string | null, supabase: Admin = createAdminClient()) {
  const now = new Date().toISOString();
  await supabase.from('assault_potion_loadouts').update({ is_default: false, updated_at: now }).or(ownerFilter(o)).eq('is_default', true);
  if (!loadoutId) return;
  const { error } = await supabase
    .from('assault_potion_loadouts')
    .update({ is_default: true, updated_at: now })
    .eq('id', loadoutId)
    .or(ownerFilter(o));
  if (error) throw new Error(error.message);
}

/**
 * Before web + Discord were unified a person could have one default on each side. Stamping both
 * keys on a row would then break the one-default-per-user/per-discord unique indexes: keep the newest.
 */
async function dedupeDefaults(o: LoadoutOwner, supabase: Admin) {
  const { data } = await supabase
    .from('assault_potion_loadouts')
    .select('id')
    .or(ownerFilter(o))
    .eq('is_default', true)
    .order('updated_at', { ascending: false });
  const extra = (data ?? []).slice(1).map((r) => r.id as string);
  if (extra.length) await supabase.from('assault_potion_loadouts').update({ is_default: false }).in('id', extra);
}

/** Insert or update a loadout for this owner; stamps both keys so it shows on web and Discord. */
export async function saveOwnerLoadout(
  o: LoadoutOwner,
  input: { id?: string; name: string; is_default?: boolean; combat_potion_ids: number[]; xp_potion_ids: number[] },
  supabase: Admin = createAdminClient(),
): Promise<SavedLoadout> {
  const now = new Date().toISOString();
  const fields = {
    name: input.name.slice(0, 80),
    combat_potion_ids: input.combat_potion_ids,
    xp_potion_ids: input.xp_potion_ids,
    updated_at: now,
    ...(o.userId ? { user_id: o.userId } : {}),
    ...(o.discordId ? { discord_user_id: o.discordId } : {}),
  };
  // Same name = same loadout (Discord saves by name), unless an id was given.
  let id = input.id ?? null;
  if (!id) {
    const { data: same } = await supabase
      .from('assault_potion_loadouts')
      .select('id')
      .or(ownerFilter(o))
      .ilike('name', fields.name)
      .limit(1)
      .maybeSingle();
    id = (same?.id as string | undefined) ?? null;
  }
  await dedupeDefaults(o, supabase);
  if (input.is_default) await setOwnerDefault(o, null, supabase);
  const q = id
    ? supabase
        .from('assault_potion_loadouts')
        .update({ ...fields, ...(input.is_default ? { is_default: true } : {}) })
        .eq('id', id)
        .or(ownerFilter(o))
    : supabase.from('assault_potion_loadouts').insert({ user_id: null, ...fields, is_default: !!input.is_default });
  const { data, error } = await q.select('*').single();
  if (error) throw new Error(error.message);
  return data as SavedLoadout;
}

export async function deleteOwnerLoadout(o: LoadoutOwner, loadoutId: string, supabase: Admin = createAdminClient()) {
  const { error } = await supabase.from('assault_potion_loadouts').delete().eq('id', loadoutId).or(ownerFilter(o));
  if (error) throw new Error(error.message);
}

export async function getUserLoadouts(request: Request): Promise<SavedLoadout[]> {
  const supabase = createServerClient(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  return listOwnerLoadouts(await ownerForUser(user.id));
}

export async function getDefaultLoadoutForUser(userId: string): Promise<SavedLoadout | null> {
  const list = await listOwnerLoadouts(await ownerForUser(userId));
  return list.find((l) => l.is_default) ?? null;
}

export async function listLoadoutsForDiscordUser(discordUserId: string): Promise<SavedLoadout[]> {
  return listOwnerLoadouts(await ownerForDiscord(discordUserId));
}

export async function getLoadoutForDiscordUser(discordUserId: string, name?: string): Promise<SavedLoadout | null> {
  const list = await listLoadoutsForDiscordUser(discordUserId);
  if (!name) return list.find((l) => l.is_default) ?? null;
  return list.find((l) => l.name.toLowerCase() === name.toLowerCase()) ?? null;
}

export async function saveDiscordLoadout(
  discordUserId: string,
  input: { name: string; combat_potion_ids: number[]; xp_potion_ids: number[] },
): Promise<SavedLoadout> {
  return saveOwnerLoadout(await ownerForDiscord(discordUserId), input);
}

export async function setDiscordLoadoutDefault(discordUserId: string, loadoutId: string): Promise<void> {
  await setOwnerDefault(await ownerForDiscord(discordUserId), loadoutId);
}

export async function deleteDiscordLoadout(discordUserId: string, loadoutId: string): Promise<void> {
  await deleteOwnerLoadout(await ownerForDiscord(discordUserId), loadoutId);
}

export async function linkLoadoutToDiscord(
  loadoutId: string,
  discordUserId: string,
): Promise<{ ok: boolean; error?: string; loadout?: SavedLoadout }> {
  const supabase = createAdminClient();
  const { data: existing } = await supabase
    .from('assault_potion_loadouts')
    .select('*')
    .eq('id', loadoutId)
    .maybeSingle();
  if (!existing) return { ok: false, error: 'Loadout not found.' };
  if (existing.discord_user_id && existing.discord_user_id !== discordUserId) {
    return { ok: false, error: 'This loadout is already linked to another Discord user.' };
  }
  const { data, error } = await supabase
    .from('assault_potion_loadouts')
    .update({ discord_user_id: discordUserId, updated_at: new Date().toISOString() })
    .eq('id', loadoutId)
    .select('*')
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, loadout: data as SavedLoadout };
}
