/**
 * Character combat stats builder — ported from dungeon-tracker lib/calculations.ts
 * (calculateCombatStats / calculateTieredGearStats), trimmed to combat only.
 *
 * Sources:
 *  - stat levels (API): str→AP, def→Prot, speed→Agi, dex→Acc, × 2.4
 *  - pet (API equipped pet, or sandbox): PET_STATS × (mastery + pat + evolution)
 *  - gear (picker from gear_items catalog, with tier modifiers)
 *  - class battle talents by combat level (class-talents.ts)
 *  - manual adjustments (anything the catalog doesn't cover)
 *
 * The IdleMMO API exposes no equipment combat stats, so gear is user-picked.
 */
import { calculatePetCombatStats } from './pet-data';
import { classTalents, type TalentTotals } from './class-talents';

export const STAT_MULTIPLIER = 2.4;
/** Every character starts with 5% crit chance. */
export const BASE_CRIT_CHANCE = 5;

export type StatKey = 'attackPower' | 'protection' | 'agility' | 'accuracy';
export type StatBlock = Record<StatKey, number>;

export const ZERO_STATS: StatBlock = { attackPower: 0, protection: 0, agility: 0, accuracy: 0 };

export interface TierModifiers {
  agility?: number;
  accuracy?: number;
  protection?: number;
  attack_power?: number;
  critical_damage?: number;
}

export interface GearItem {
  id: number;
  name: string;
  slot: string;
  quality: string;
  agility: number;
  accuracy: number;
  protection: number;
  attack_power: number;
  critical_damage: number;
  combat_level: number;
  tier_modifiers: TierModifiers | null;
  image_url: string | null;
  max_tier: number | null;
}

export interface GearSelection {
  slot: string;
  gear_item_id: number;
  tier: number;
}

export interface PetConfig {
  species: string | null;
  level: number;
  mastery: number;
  patted: boolean;
  evolution: number;
}

export const GEAR_SLOTS = [
  { key: 'sword', label: 'Sword', itemSlot: 'sword' },
  { key: 'dagger', label: 'Dagger', itemSlot: 'dagger' },
  { key: 'offhand_dagger', label: 'Off-hand dagger', itemSlot: 'dagger' },
  { key: 'bow', label: 'Bow', itemSlot: 'bow' },
  { key: 'shield', label: 'Shield', itemSlot: 'shield' },
  { key: 'helmet', label: 'Helmet', itemSlot: 'helmet' },
  { key: 'chestplate', label: 'Chestplate', itemSlot: 'chestplate' },
  { key: 'gauntlets', label: 'Gauntlets', itemSlot: 'gauntlets' },
  { key: 'greaves', label: 'Greaves', itemSlot: 'greaves' },
  { key: 'boots', label: 'Boots', itemSlot: 'boots' },
] as const;

export function slotLabelOf(slot: string): string {
  return GEAR_SLOTS.find((s) => s.key === slot)?.label ?? slot;
}

/** Catalog item slot (gear_items.slot) a selection slot takes: both dagger slots take daggers. */
export function itemSlotOf(selectionSlot: string): string {
  return GEAR_SLOTS.find((s) => s.key === selectionSlot)?.itemSlot ?? selectionSlot;
}

/** Selection slots a catalog item can go in (a dagger: main hand or off hand). */
export function selectionSlotsFor(itemSlot: string): string[] {
  return GEAR_SLOTS.filter((s) => s.itemSlot === itemSlot).map((s) => s.key);
}

/**
 * Hands: sword + shield, dagger + dagger, dagger + shield, or a bow (two-handed).
 * Equipping one of these clears the listed slots.
 */
export const HAND_SLOT_CONFLICTS: Record<string, string[]> = {
  sword: ['dagger', 'offhand_dagger', 'bow'],
  dagger: ['sword', 'bow'],
  shield: ['offhand_dagger', 'bow'],
  offhand_dagger: ['sword', 'shield', 'bow'],
  bow: ['sword', 'dagger', 'offhand_dagger', 'shield'],
};

/** The off-hand dagger only shows once a main-hand dagger is on (or one is already there). */
export function slotVisible(slot: string, gear: Pick<GearSelection, 'slot'>[]): boolean {
  if (slot !== 'offhand_dagger') return true;
  return gear.some((g) => g.slot === 'dagger' || g.slot === 'offhand_dagger');
}

/**
 * Put an item in a slot (null = take it off), clearing hand slots it can't be worn with.
 * Taking off the main dagger moves the off-hand one into the main hand.
 */
export function equipGear(gear: GearSelection[], slot: string, itemId: number | null, tier = 1): GearSelection[] {
  let next = gear.filter((g) => g.slot !== slot);
  if (itemId) {
    const conflicts = HAND_SLOT_CONFLICTS[slot] ?? [];
    next = next.filter((g) => !conflicts.includes(g.slot));
    next.push({ slot, gear_item_id: itemId, tier });
  } else if (slot === 'dagger') {
    next = next.map((g) => (g.slot === 'offhand_dagger' ? { ...g, slot: 'dagger' } : g));
  }
  return next;
}

export const MAX_TIER: Record<string, number> = { legendary: 16, mythic: 35 };

/**
 * Crit chance % on mythic gear (CL 90–96), by slot and item combat level.
 * Not in the catalog data; from the in-game items. Doesn't scale with tier.
 */
export const GEAR_CRIT_CHANCE: Record<string, Record<number, number>> = {
  sword: { 90: 1, 91: 2, 92: 3, 93: 4, 94: 5, 95: 6, 96: 7 },
  bow: { 90: 1, 91: 2, 92: 3, 93: 4, 94: 5, 95: 6, 96: 7 },
  dagger: { 90: 1, 91: 2, 92: 2, 93: 2, 94: 3, 95: 3, 96: 3 },
  chestplate: { 90: 1, 91: 1, 92: 2, 93: 3, 94: 3, 95: 4, 96: 5 },
};

export function gearCritChance(item: Pick<GearItem, 'slot' | 'quality' | 'combat_level'>): number {
  if (item.quality !== 'mythic') return 0;
  return GEAR_CRIT_CHANCE[item.slot]?.[item.combat_level] ?? 0;
}

/** T1 = base (0 upgrades). effective = base + (tier − 1) × modifier */
export function tieredGearStats(item: GearItem, tier: number) {
  const m = item.tier_modifiers ?? {};
  const u = Math.max(0, tier - 1);
  return {
    critChance: gearCritChance(item),
    attackPower: item.attack_power + (m.attack_power ?? 0) * u,
    protection: item.protection + (m.protection ?? 0) * u,
    agility: item.agility + (m.agility ?? 0) * u,
    accuracy: item.accuracy + (m.accuracy ?? 0) * u,
    critDamage: item.critical_damage + (m.critical_damage ?? 0) * u,
  };
}

export interface StatLevels {
  strength?: { level: number };
  defence?: { level: number };
  speed?: { level: number };
  dexterity?: { level: number };
}

export interface CharacterInput {
  stats: StatLevels | null;
  /** API skills; skills.combat.level is the real combat level. */
  skills?: Record<string, { level: number }> | null;
  characterClass: string | null;
  pet: PetConfig | null;
  gear: GearSelection[];
  gearCatalog: Map<number, GearItem>;
  manual: StatBlock;
}

export interface CritBreakdown {
  base: number;
  pet: number;
  gear: number;
  classBonus: number;
  total: number;
}

export interface CharacterStats extends StatBlock {
  critDamageFromGear: number;
  critChance: CritBreakdown;
  critDamage: CritBreakdown;
  damageFlat: { classBonus: number; total: number };
  petMaxHealth: number;
  combatLevel: number;
  talents: TalentTotals;
  breakdown: {
    levels: StatBlock;
    pet: StatBlock;
    gear: StatBlock;
    classBonus: StatBlock;
    manual: StatBlock;
  };
}

/** Real combat level from skills.combat; falls back to the stat average if skills are missing. */
export function combatLevelOf(skills: Record<string, { level: number }> | null | undefined, stats: StatLevels | null): number {
  const lvl = skills?.combat?.level;
  return typeof lvl === 'number' && lvl > 0 ? lvl : combatLevelFromStats(stats);
}

export function combatLevelFromStats(stats: StatLevels | null): number {
  const s = stats ?? {};
  return Math.floor(
    ((s.strength?.level ?? 0) + (s.defence?.level ?? 0) + (s.speed?.level ?? 0) + (s.dexterity?.level ?? 0)) / 4
  );
}

export function buildCharacterStats(input: CharacterInput): CharacterStats {
  const s = input.stats ?? {};
  const levels: StatBlock = {
    attackPower: Math.round((s.strength?.level ?? 0) * STAT_MULTIPLIER),
    protection: Math.round((s.defence?.level ?? 0) * STAT_MULTIPLIER),
    agility: Math.round((s.speed?.level ?? 0) * STAT_MULTIPLIER),
    accuracy: Math.round((s.dexterity?.level ?? 0) * STAT_MULTIPLIER),
  };

  let pet: StatBlock = { ...ZERO_STATS };
  let petCritChance = 0;
  let petCritDamage = 0;
  let petMaxHealth = 0;
  if (input.pet?.species) {
    const p = calculatePetCombatStats(
      input.pet.species,
      input.pet.level,
      input.pet.mastery,
      input.pet.patted,
      input.pet.evolution
    );
    if (p) {
      pet = { attackPower: p.attackPower, protection: p.protection, agility: p.agility, accuracy: p.accuracy };
      petCritChance = p.critChance;
      petCritDamage = p.critDamage;
      petMaxHealth = p.maxHealth;
    }
  }

  const gear: StatBlock = { ...ZERO_STATS };
  let critDamageFromGear = 0;
  let critChanceFromGear = 0;
  for (const g of input.gear) {
    const item = input.gearCatalog.get(g.gear_item_id);
    if (!item) continue;
    const t = tieredGearStats(item, g.tier);
    gear.attackPower += t.attackPower;
    gear.protection += t.protection;
    gear.agility += t.agility;
    gear.accuracy += t.accuracy;
    critDamageFromGear += t.critDamage;
    critChanceFromGear += t.critChance;
  }

  const combatLevel = combatLevelOf(input.skills, input.stats);
  const talents = classTalents(input.characterClass, combatLevel);
  const classBonus: StatBlock = { ...talents.stats };

  const manual = input.manual;
  const sum = (k: StatKey) => levels[k] + pet[k] + gear[k] + classBonus[k] + (manual[k] ?? 0);

  return {
    attackPower: sum('attackPower'),
    protection: sum('protection'),
    agility: sum('agility'),
    accuracy: sum('accuracy'),
    critDamageFromGear,
    critChance: {
      base: BASE_CRIT_CHANCE,
      pet: petCritChance,
      gear: critChanceFromGear,
      classBonus: talents.critChance,
      total: BASE_CRIT_CHANCE + petCritChance + critChanceFromGear + talents.critChance,
    },
    critDamage: {
      base: 0,
      pet: petCritDamage,
      gear: critDamageFromGear,
      classBonus: talents.critDamage,
      total: petCritDamage + critDamageFromGear + talents.critDamage,
    },
    damageFlat: {
      classBonus: talents.damageFlat,
      total: talents.damageFlat,
    },
    petMaxHealth,
    combatLevel,
    talents,
    breakdown: { levels, pet, gear, classBonus, manual },
  };
}

/* ─── Buffs (same order as HTML: % scales base only, flat adds after) ─── */

export interface BuffState {
  /** Total potion % (derived from potionIds when those are set). */
  apPotionPct: number;
  protPotionPct: number;
  /** Combat potions picked on /combat (slot-legal). Older setups only have the % fields. */
  potionIds?: number[];
  /** XP-slot potions (Battle XP / Combat XP) from an assault preset or loadout. No combat stat effect yet. */
  xpPotionIds?: number[];
  /** Assault siege: Scorpion +100 AP */
  scorpion: boolean;
  /** Assault siege: Explosive Keg +10% AP */
  keg: boolean;
  /** Assault siege: Med tent +50 Prot */
  medTent: boolean;
  /** Assault siege: Med kit +10% Prot */
  medKit: boolean;
}

export const NO_BUFFS: BuffState = {
  apPotionPct: 0,
  protPotionPct: 0,
  scorpion: false,
  keg: false,
  medTent: false,
  medKit: false,
};

export function applyBuffs(base: StatBlock, b: BuffState): StatBlock {
  const apPct = b.apPotionPct + (b.keg ? 10 : 0);
  const protPct = b.protPotionPct + (b.medKit ? 10 : 0);
  return {
    attackPower: Math.round(base.attackPower * (1 + apPct / 100)) + (b.scorpion ? 100 : 0),
    protection: Math.floor(base.protection * (1 + protPct / 100)) + (b.medTent ? 50 : 0),
    agility: base.agility,
    accuracy: base.accuracy,
  };
}

/* ─── Slayer from API effects ─── */

export interface ApiEffect {
  source: string;
  target: string;
  attribute: string;
  value: number;
  value_type: string;
  enemy_id?: number | null;
  location_id?: number | null;
  expire_at?: string | null;
}

/** Personal slayer damage % keyed by enemy_id (effects source=slayer_rank, target=battle, attribute=damage). */
export function slayerByEnemy(effects: ApiEffect[] | null | undefined): Record<number, number> {
  const out: Record<number, number> = {};
  for (const e of effects ?? []) {
    if (e.source === 'slayer_rank' && e.target === 'battle' && e.attribute === 'damage' && e.enemy_id != null) {
      out[e.enemy_id] = (out[e.enemy_id] ?? 0) + e.value;
    }
  }
  return out;
}
