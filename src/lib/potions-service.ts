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
