/**
 * Class battle talents (in-game class page). Applied automatically by combat level.
 * Only Warrior, Shadowblade and Ranger have battle talents. Every other class
 * (skill classes, Monk, Beastmaster, Banished, Forsaken, Cursed) has none.
 */
import type { StatKey } from './character-stats';

export type TalentEffect =
  | { kind: 'stat'; stat: StatKey; value: number }
  | { kind: 'damageFlat'; value: number }
  | { kind: 'critChance'; value: number }
  | { kind: 'critDamage'; value: number };

export interface ClassTalent {
  name: string;
  unlockLevel: number;
  effect: TalentEffect;
}

export const CLASS_TALENTS: Record<string, ClassTalent[]> = {
  WARRIOR: [
    { name: 'Mighty Strike', unlockLevel: 10, effect: { kind: 'damageFlat', value: 2 } },
    { name: 'Rampage', unlockLevel: 35, effect: { kind: 'critDamage', value: 10 } },
    { name: 'Shield Wall', unlockLevel: 70, effect: { kind: 'stat', stat: 'protection', value: 40 } },
  ],
  SHADOWBLADE: [
    { name: 'Backstab', unlockLevel: 10, effect: { kind: 'critChance', value: 2 } },
    { name: 'Shadow Piercer', unlockLevel: 35, effect: { kind: 'critDamage', value: 10 } },
    { name: "Shadow's Veil", unlockLevel: 70, effect: { kind: 'stat', stat: 'agility', value: 40 } },
  ],
  RANGER: [
    { name: 'Piercing Shot', unlockLevel: 10, effect: { kind: 'damageFlat', value: 2 } },
    { name: 'Eagles Eye', unlockLevel: 35, effect: { kind: 'critChance', value: 3 } },
    { name: "Nature's Aid", unlockLevel: 70, effect: { kind: 'critDamage', value: 10 } },
  ],
};

/** Classes with no market or trading access (Ironman-style) — can't buy potions. */
export const NO_MARKET_CLASSES = new Set(['BANISHED', 'CURSED']);

export function hasMarketAccess(characterClass: string | null | undefined): boolean {
  return !NO_MARKET_CLASSES.has((characterClass ?? '').toUpperCase());
}

export interface TalentTotals {
  stats: Record<StatKey, number>;
  damageFlat: number;
  critChance: number;
  critDamage: number;
  active: ClassTalent[];
  locked: ClassTalent[];
}

export function classTalents(characterClass: string | null | undefined, combatLevel: number): TalentTotals {
  const out: TalentTotals = {
    stats: { attackPower: 0, protection: 0, agility: 0, accuracy: 0 },
    damageFlat: 0,
    critChance: 0,
    critDamage: 0,
    active: [],
    locked: [],
  };
  const list = CLASS_TALENTS[(characterClass ?? '').toUpperCase()] ?? [];
  for (const t of list) {
    if (combatLevel < t.unlockLevel) {
      out.locked.push(t);
      continue;
    }
    out.active.push(t);
    const e = t.effect;
    if (e.kind === 'stat') out.stats[e.stat] += e.value;
    else out[e.kind] += e.value;
  }
  return out;
}
