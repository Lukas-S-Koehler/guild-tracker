export type SlotKey = 'battle_xp' | 'combat_xp' | 'attack' | 'protection';

export interface CombatPotion {
  id: number;
  name: string;
  quality: 'PREMIUM' | 'EPIC' | 'LEGENDARY' | 'MYTHIC';
  is_tradeable: boolean;
  attack_power_bonus: number;
  protection_bonus: number;
  attack_power_is_percentage: boolean;
  protection_is_percentage: boolean;
  vendor_price: number;
  market_price: number | null;
  avg_recent_sales: string | null;
  hashed_item_id: string | null;
  image_url: string | null;
  duration_minutes: number | null;
  last_price_sync: string | null;
}

export interface XpPotion {
  id: number;
  name: string;
  category: 'combat_xp' | 'battle_xp';
  quality: 'PREMIUM' | 'EPIC' | 'LEGENDARY' | 'MYTHIC' | null;
  type: string | null;
  effect_value: number;
  target: string | null;
  xp_value: number;
  efficiency_value: number;
  stacks: boolean;
  market_price: number | null;
  avg_recent_sales: string | null;
  image_url: string | null;
  hashed_item_id: string | null;
  duration_minutes: number | null;
  is_free_common: boolean;
  description: string | null;
  last_price_sync: string | null;
}

export interface Loadout {
  combat_potion_ids: number[];
  xp_potion_ids: number[];
}

export function slotsForCombatPotion(p: CombatPotion): SlotKey[] {
  const slots: SlotKey[] = [];
  if (p.attack_power_bonus > 0) slots.push('attack');
  if (p.protection_bonus > 0) slots.push('protection');
  return slots;
}

export function slotForXpPotion(p: XpPotion): SlotKey {
  return p.category === 'battle_xp' ? 'battle_xp' : 'combat_xp';
}

export interface SlotState {
  battle_xp: XpPotion | null;
  combat_xp: XpPotion | null;
  attack: CombatPotion | null;
  protection: CombatPotion | null;
}

export function getSlotState(
  loadout: Loadout,
  combat: CombatPotion[],
  xp: XpPotion[],
): SlotState {
  const state: SlotState = { battle_xp: null, combat_xp: null, attack: null, protection: null };
  const cById = new Map(combat.map((p) => [p.id, p]));
  const xById = new Map(xp.map((p) => [p.id, p]));

  for (const id of loadout.xp_potion_ids) {
    const p = xById.get(id);
    if (!p) continue;
    if (p.category === 'battle_xp' && !state.battle_xp) state.battle_xp = p;
    else if (p.category === 'combat_xp' && !state.combat_xp) state.combat_xp = p;
  }
  for (const id of loadout.combat_potion_ids) {
    const p = cById.get(id);
    if (!p) continue;
    for (const slot of slotsForCombatPotion(p)) {
      if (slot === 'attack' && !state.attack) state.attack = p;
      else if (slot === 'protection' && !state.protection) state.protection = p;
    }
  }
  return state;
}

export interface AddCheck {
  ok: boolean;
  reason?: string;
  conflictingSlot?: SlotKey;
}

export function canAddCombatPotion(
  potion: CombatPotion,
  state: SlotState,
): AddCheck {
  const slots = slotsForCombatPotion(potion);
  if (slots.length === 0) return { ok: false, reason: 'No combat stat bonus.' };
  for (const slot of slots) {
    const occupant = state[slot];
    if (occupant) {
      return {
        ok: false,
        conflictingSlot: slot,
        reason: `${slot === 'attack' ? 'Attack' : 'Protection'} slot filled by ${occupant.name}.`,
      };
    }
  }
  return { ok: true };
}

export function canAddXpPotion(
  potion: XpPotion,
  state: SlotState,
): AddCheck {
  const slot = slotForXpPotion(potion);
  const occupant = state[slot];
  if (occupant) {
    return {
      ok: false,
      conflictingSlot: slot,
      reason: `${slot === 'battle_xp' ? 'Battle XP' : 'Combat XP'} slot filled by ${occupant.name}.`,
    };
  }
  return { ok: true };
}

export interface Violation {
  slot: SlotKey;
  message: string;
}

export function violations(
  loadout: Loadout,
  combat: CombatPotion[],
  xp: XpPotion[],
): Violation[] {
  const vs: Violation[] = [];
  const slotCount: Record<SlotKey, number> = { battle_xp: 0, combat_xp: 0, attack: 0, protection: 0 };
  const cById = new Map(combat.map((p) => [p.id, p]));
  const xById = new Map(xp.map((p) => [p.id, p]));

  for (const id of loadout.xp_potion_ids) {
    const p = xById.get(id);
    if (!p) continue;
    slotCount[slotForXpPotion(p)]++;
  }
  for (const id of loadout.combat_potion_ids) {
    const p = cById.get(id);
    if (!p) continue;
    for (const slot of slotsForCombatPotion(p)) slotCount[slot]++;
  }
  for (const slot of Object.keys(slotCount) as SlotKey[]) {
    if (slotCount[slot] > 1) {
      vs.push({ slot, message: `${slot} slot has ${slotCount[slot]} potions; only one allowed.` });
    }
  }
  return vs;
}

export function loadoutCost(
  loadout: Loadout,
  combat: CombatPotion[],
  xp: XpPotion[],
): { tradeable: number; hasUnpriced: boolean } {
  const cById = new Map(combat.map((p) => [p.id, p]));
  const xById = new Map(xp.map((p) => [p.id, p]));
  let total = 0;
  let hasUnpriced = false;
  for (const id of loadout.combat_potion_ids) {
    const p = cById.get(id);
    if (!p) continue;
    if (!p.is_tradeable) continue;
    if (p.market_price == null) { hasUnpriced = true; continue; }
    total += p.market_price;
  }
  for (const id of loadout.xp_potion_ids) {
    const p = xById.get(id);
    if (!p) continue;
    if (p.market_price == null) { hasUnpriced = true; continue; }
    total += p.market_price;
  }
  return { tradeable: total, hasUnpriced };
}

/** Activation minute offset from launch for a potion of given duration.
 *  Anchor: final full-buff refresh at launch + 60. Potion must last through +60, so
 *  activate at `60 - duration`. Negative = pre-launch; positive = post-launch.
 *  Returns null if duration unknown.
 */
export function computeActivationMinutes(durationMinutes: number | null | undefined): number | null {
  if (durationMinutes == null || durationMinutes <= 0) return null;
  return 60 - durationMinutes;
}

export const SLOT_LABELS: Record<SlotKey, string> = {
  battle_xp: 'Battle XP',
  combat_xp: 'Combat XP',
  attack: 'Attack Power',
  protection: 'Protection',
};

export const QUALITY_CLASSES: Record<string, string> = {
  STANDARD: 'bg-stone-500/20 text-stone-300 border-stone-500/40',
  PREMIUM: 'bg-slate-500/20 text-slate-300 border-slate-500/40',
  EPIC: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
  LEGENDARY: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  MYTHIC: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
};
