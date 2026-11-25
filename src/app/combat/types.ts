import type { ApiEffect, BuffState, GearItem, GearSelection, StatBlock } from '@/lib/combat/character-stats';

export interface ProfilePet {
  id: number;
  name: string;
  species: string | null;
  image_url: string | null;
  level: number;
  quality: string;
  equipped?: boolean;
  evolution: number;
}

export interface ProfileSettings {
  maxHp?: number;
  /** Food name from FOODS (default Cooked Great White Shark). */
  food?: string;
  /** Legacy manual value; synced skills['pet-mastery'] wins when present. */
  petMastery?: number;
  petPatted?: boolean;
  manual?: StatBlock;
}

export interface CombatProfile {
  id: string;
  member_id: string | null;
  hashed_id: string;
  ign: string;
  character_class: string | null;
  image_url: string | null;
  stats: Record<string, { level: number; experience: number }> | null;
  /** null until the profile is re-synced after the v2 migration. */
  skills: Record<string, { level: number; experience: number }> | null;
  equipped_pet: ProfilePet | null;
  pets: ProfilePet[];
  effects: ApiEffect[];
  location: { id: number; name: string } | null;
  gear: GearSelection[];
  settings: ProfileSettings;
  last_sync: string | null;
}

export interface Enemy {
  id: number;
  name: string;
  level: number;
  zone_id: number;
  zone_name: string;
  health: number;
  experience: number;
  image_url: string | null;
}

export interface PotionRow {
  id: number;
  name: string;
  quality: string;
  is_tradeable: boolean;
  attack_power_bonus: number;
  protection_bonus: number;
  duration_minutes: number | null;
  market_price: number | null;
  avg_recent_sales: string | null;
  image_url: string | null;
}

/** Saved potion loadout from /assault/potions or Discord /potions. */
export interface PotionLoadout {
  id: string;
  name: string;
  is_default: boolean;
  source: 'web' | 'discord';
  combat_potion_ids: number[];
  xp_potion_ids: number[];
}

/** XP-slot potion (Battle XP / Combat XP), assaulters only on /combat. */
export interface XpPotionRow {
  id: number;
  name: string;
  category: 'combat_xp' | 'battle_xp';
  quality: string | null;
  effect_value: number;
  xp_value: number;
  efficiency_value: number;
  duration_minutes: number | null;
  description: string | null;
  image_url: string | null;
}

/** Assault potion preset (Budget / Mid / Whale …) from /assault/potions. */
export interface PotionPreset {
  id: string;
  label: string;
  combat_potion_ids: number[];
  xp_potion_ids: number[];
  assault_tier?: number;
}

export interface MemberRow {
  id: string;
  ign: string;
  hashed_id: string;
  avatar_url: string | null;
  total_level: number | null;
}

export interface SetupRow {
  id: string;
  profile_id: string | null;
  name: string;
  data: SandboxState;
  updated_at: string;
  /** Shown on /me/assault (one per user). */
  pinned?: boolean;
}

export interface PetState {
  mode: 'profile' | 'sandbox';
  species: string | null;
  level: number;
  evolution: number;
}

export interface TargetState {
  zoneId: number | null;
  enemyId: number | null;
  /** Enemy scaling (CL 80+, up to your CL; CL 100+ up to 150). null = enemy's own level. */
  scaledLevel: number | null;
  customHp: number | null;
}

/** Everything a saved setup captures (on top of the profile). */
export interface SandboxState {
  pet: PetState;
  /** 'mine' = the setup uses whatever your saved gear is; 'sandbox' = the gear stored below. */
  gearMode?: 'mine' | 'sandbox';
  gear: GearSelection[];
  /** Sandbox class (only combat-relevant ones). null/undefined = your real class. */
  classOverride?: string | null;
  buffs: BuffState;
  target: TargetState;
  counts: Record<number, number>;
  /** Sandbox slayer % per enemy_id (DE/DI only). Missing = your synced slayer rank. */
  slayer?: Record<number, number>;
}

export type { GearItem };
