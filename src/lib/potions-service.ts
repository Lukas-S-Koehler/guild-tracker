import { createAdminClient, createServerClient } from '@/lib/supabase-server';
import type { CombatPotion, Loadout, XpPotion } from '@/lib/potion-rules';

export interface Preset {
  id: string;
  label: string;
  description: string | null;
  sort_order: number;
  combat_potion_ids: number[];
  xp_potion_ids: number[];
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

export async function getUserLoadouts(request: Request): Promise<SavedLoadout[]> {
  const supabase = createServerClient(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data } = await supabase
    .from('assault_potion_loadouts')
    .select('*')
    .eq('user_id', user.id)
    .order('is_default', { ascending: false })
    .order('updated_at', { ascending: false });
  return (data ?? []) as SavedLoadout[];
}

export async function getDefaultLoadoutForUser(userId: string): Promise<SavedLoadout | null> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('assault_potion_loadouts')
    .select('*')
    .eq('user_id', userId)
    .eq('is_default', true)
    .maybeSingle();
  return (data as SavedLoadout) ?? null;
}

export async function listLoadoutsForDiscordUser(discordUserId: string): Promise<SavedLoadout[]> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('assault_potion_loadouts')
    .select('*')
    .eq('discord_user_id', discordUserId)
    .order('is_default', { ascending: false })
    .order('updated_at', { ascending: false });
  return (data ?? []) as SavedLoadout[];
}

export async function getLoadoutForDiscordUser(
  discordUserId: string,
  name?: string,
): Promise<SavedLoadout | null> {
  const supabase = createAdminClient();
  let q = supabase
    .from('assault_potion_loadouts')
    .select('*')
    .eq('discord_user_id', discordUserId);
  if (name) q = q.ilike('name', name);
  else q = q.eq('is_default', true);
  const { data } = await q.order('updated_at', { ascending: false }).limit(1).maybeSingle();
  return (data as SavedLoadout | null) ?? null;
}

export async function saveDiscordLoadout(
  discordUserId: string,
  input: { name: string; combat_potion_ids: number[]; xp_potion_ids: number[] },
): Promise<SavedLoadout> {
  const supabase = createAdminClient();
  const { data: existing } = await supabase
    .from('assault_potion_loadouts')
    .select('*')
    .eq('discord_user_id', discordUserId)
    .ilike('name', input.name)
    .maybeSingle();
  if (existing) {
    const { data, error } = await supabase
      .from('assault_potion_loadouts')
      .update({
        combat_potion_ids: input.combat_potion_ids,
        xp_potion_ids: input.xp_potion_ids,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return data as SavedLoadout;
  }
  const { data, error } = await supabase
    .from('assault_potion_loadouts')
    .insert({
      discord_user_id: discordUserId,
      user_id: null,
      name: input.name,
      is_default: false,
      combat_potion_ids: input.combat_potion_ids,
      xp_potion_ids: input.xp_potion_ids,
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as SavedLoadout;
}

export async function setDiscordLoadoutDefault(
  discordUserId: string,
  loadoutId: string,
): Promise<void> {
  const supabase = createAdminClient();
  await supabase
    .from('assault_potion_loadouts')
    .update({ is_default: false, updated_at: new Date().toISOString() })
    .eq('discord_user_id', discordUserId);
  const { error } = await supabase
    .from('assault_potion_loadouts')
    .update({ is_default: true, updated_at: new Date().toISOString() })
    .eq('id', loadoutId)
    .eq('discord_user_id', discordUserId);
  if (error) throw new Error(error.message);
}

export async function deleteDiscordLoadout(
  discordUserId: string,
  loadoutId: string,
): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('assault_potion_loadouts')
    .delete()
    .eq('id', loadoutId)
    .eq('discord_user_id', discordUserId);
  if (error) throw new Error(error.message);
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
