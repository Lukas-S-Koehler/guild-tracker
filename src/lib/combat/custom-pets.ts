/**
 * Admin-added pets (table custom_pets). Client-safe: no server imports.
 * New pets are pasted from the in-game pet stats panel, e.g.
 *   Agility / +0.45 / Per Level / 3 / Accuracy / +0.6 / Per Level / 6 / … / Critical Chance / 12
 * (label, optional "+perLevel" + "Per Level", then the base value).
 */
import { PET_STATS, PET_EXTRA, EVENT_PETS } from './pet-data';
import { PET_HUNT_STATS } from './pet-hunting';

export type Growth = { base: number; perLevel: number };
/** 'Event' pets drain stamina like Epic and are stored in PET_STATS as Epic, shown as Event. */
export const PET_QUALITIES = ['Standard', 'Refined', 'Premium', 'Epic', 'Event', 'Legendary', 'Mythic'] as const;
export type PetQuality = (typeof PET_QUALITIES)[number];

export interface CustomPetStats {
  agility: Growth;
  accuracy: Growth;
  protection: Growth;
  attackPower: Growth;
  moveSpeed: Growth;
  stamina: Growth;
  maxHealth: Growth;
  critChance: Growth;
  critDamage: Growth;
}

export interface CustomPet {
  name: string;
  quality: PetQuality;
  stats: CustomPetStats;
}

const LABELS: Record<string, keyof CustomPetStats> = {
  agility: 'agility',
  accuracy: 'accuracy',
  protection: 'protection',
  'attack power': 'attackPower',
  'movement speed': 'moveSpeed',
  'max stamina': 'stamina',
  'max health': 'maxHealth',
  'critical chance': 'critChance',
  'critical damage': 'critDamage',
};

const NUM = /^[+-]?\d+(\.\d+)?%?$/;
const num = (s: string) => Number(s.replace(/[+%]/g, ''));

/** Parse the in-game stats paste. Returns the stats plus any labels that were missing. */
export function parsePetStatsPaste(text: string): { stats: CustomPetStats | null; missing: string[] } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out: Partial<CustomPetStats> = {};
  for (let i = 0; i < lines.length; i++) {
    const key = LABELS[lines[i].toLowerCase()];
    if (!key) continue;
    const a = lines[i + 1];
    const b = lines[i + 2];
    const c = lines[i + 3];
    if (a && NUM.test(a) && b?.toLowerCase() === 'per level' && c && NUM.test(c)) {
      out[key] = { base: num(c), perLevel: num(a) };
      i += 3;
    } else if (a && NUM.test(a)) {
      out[key] = { base: num(a), perLevel: 0 };
      i += 1;
    }
  }
  const missing = Object.entries(LABELS).filter(([, k]) => !out[k]).map(([label]) => label);
  return { stats: missing.length ? null : (out as CustomPetStats), missing };
}

/** Add admin pets to the in-memory tables. Code-defined pets always win. Idempotent. */
export function registerCustomPets(pets: CustomPet[]) {
  for (const p of pets) {
    if (!PET_STATS[p.name] || (PET_STATS[p.name] as { custom?: boolean }).custom) {
      if (p.quality === 'Event') EVENT_PETS.add(p.name);
      PET_STATS[p.name] = Object.assign(
        { name: p.name, quality: p.quality === 'Event' ? 'Epic' : p.quality, agility: p.stats.agility, accuracy: p.stats.accuracy, protection: p.stats.protection, attackPower: p.stats.attackPower },
        { custom: true }
      );
      PET_EXTRA[p.name] = { critDamage: p.stats.critDamage, critChance: p.stats.critChance, maxHealth: p.stats.maxHealth };
      PET_HUNT_STATS[p.name] = { moveSpeed: p.stats.moveSpeed, stamina: p.stats.stamina };
    }
  }
}
