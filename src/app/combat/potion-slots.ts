import type { BuffState } from '@/lib/combat/character-stats';
import type { PotionRow, XpPotionRow } from './types';

/**
 * In-game potion slots: one attack-slot potion + one protection-slot potion.
 * A combo potion (both bonuses) takes both slots.
 */
export type PotionKind = 'attack' | 'protection' | 'combo';

export const kindOf = (p: PotionRow): PotionKind =>
  p.attack_power_bonus > 0 && p.protection_bonus > 0 ? 'combo' : p.attack_power_bonus > 0 ? 'attack' : 'protection';

const usesAttack = (p: PotionRow) => p.attack_power_bonus > 0;
const usesProt = (p: PotionRow) => p.protection_bonus > 0;

export const potionKey = (ids: number[]) => [...ids].sort((a, b) => a - b).join(',');

/** Drop unknown ids and anything that would double up a slot (first one wins). */
export function legalPotionIds(ids: number[], byId: Map<number, PotionRow>): number[] {
  let atk = false;
  let prot = false;
  const out: number[] = [];
  for (const id of ids) {
    const p = byId.get(id);
    if (!p || (!usesAttack(p) && !usesProt(p))) continue;
    if ((usesAttack(p) && atk) || (usesProt(p) && prot)) continue;
    out.push(id);
    atk ||= usesAttack(p);
    prot ||= usesProt(p);
  }
  return out;
}

/** Buffs with these potions in the slots; the % fields follow the potions. */
export function withPotions(buffs: BuffState, ids: number[], byId: Map<number, PotionRow>): BuffState {
  const legal = legalPotionIds(ids, byId);
  const picked = legal.map((id) => byId.get(id)!);
  return {
    ...buffs,
    potionIds: legal,
    apPotionPct: picked.reduce((s, p) => s + p.attack_power_bonus, 0),
    protPotionPct: picked.reduce((s, p) => s + p.protection_bonus, 0),
  };
}

/**
 * Potions behind a buff state. Setups saved before potion picking only stored %:
 * match them to real potions, or return null when no real combination gives those numbers.
 */
export function potionIdsOf(buffs: BuffState, potions: PotionRow[]): number[] | null {
  if (buffs.potionIds) return buffs.potionIds;
  const ap = buffs.apPotionPct;
  const pr = buffs.protPotionPct;
  if (!ap && !pr) return [];
  const combo = potions.find((p) => kindOf(p) === 'combo' && p.attack_power_bonus === ap && p.protection_bonus === pr);
  if (combo) return [combo.id];
  const a = ap ? potions.find((p) => kindOf(p) === 'attack' && p.attack_power_bonus === ap) : null;
  const d = pr ? potions.find((p) => kindOf(p) === 'protection' && p.protection_bonus === pr) : null;
  if ((ap && !a) || (pr && !d)) return null;
  return [a?.id, d?.id].filter((x): x is number => x != null);
}

/** Click on a potion: toggle it off, or put it in and push out whatever shares a slot with it. */
export function togglePotion(ids: number[], p: PotionRow, byId: Map<number, PotionRow>): number[] {
  if (ids.includes(p.id)) return ids.filter((x) => x !== p.id);
  const keep = ids.filter((id) => {
    const o = byId.get(id);
    return o && !((usesAttack(p) && usesAttack(o)) || (usesProt(p) && usesProt(o)));
  });
  return [...keep, p.id];
}

/** Empty one slot (clears a combo too, since it sits in both). */
export function clearSlot(ids: number[], slot: 'attack' | 'protection', byId: Map<number, PotionRow>): number[] {
  return ids.filter((id) => {
    const o = byId.get(id);
    return o && !(slot === 'attack' ? usesAttack(o) : usesProt(o));
  });
}

/* ── XP slots (Battle XP + Combat XP), assaulters only ── */

type XpLike = Pick<XpPotionRow, 'id' | 'category' | 'efficiency_value'>;
const sharesEffect = (a: XpLike, b: XpLike) => a.id !== b.id && (a.efficiency_value ?? 0) > 0 && (b.efficiency_value ?? 0) > 0;

/** One potion per XP slot, and never two hunting-efficiency potions (the game won't stack them). */
export function legalXpIds(ids: number[], byId: Map<number, XpPotionRow>): number[] {
  const out: XpPotionRow[] = [];
  for (const id of ids) {
    const p = byId.get(id);
    if (!p || out.some((o) => o.category === p.category || sharesEffect(o, p))) continue;
    out.push(p);
  }
  return out.map((p) => p.id);
}

/** Click on an XP potion: toggle it off, or put it in and push out its slot-mate / same-effect potion. */
export function toggleXp(ids: number[], p: XpPotionRow, byId: Map<number, XpPotionRow>): number[] {
  if (ids.includes(p.id)) return ids.filter((x) => x !== p.id);
  const keep = ids.filter((id) => {
    const o = byId.get(id);
    return o && o.category !== p.category && !sharesEffect(o, p);
  });
  return [...keep, p.id];
}
