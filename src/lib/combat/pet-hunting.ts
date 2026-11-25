/**
 * Pet hunting estimates for the Assault Roster (docs/assault-roster.md §3.3).
 *
 * Everything here is a CITADEL estimate (avg enemy Lv ~100, difficulty 1.00): Citadel is the
 * hardest zone, so every other zone gives MORE encounters per hunt. Label numbers accordingly.
 *
 * Verified against the community Citadel sheet (45 pets at Lv 100, pet mastery 100):
 *  - Agility       = round(floor(base + (L-1)·perLevel) × mult)        (same as combat)
 *  - Move speed    = round1(base + (L-1)·perLevel) × mult
 *  - Max stamina   = floor(base + (L-1)·perLevel)                       (no multiplier)
 *  - Hunt length   = max stamina / drain (seconds), drain by quality
 *  - Time / enemy  = fitted: 199.91 − 0.7237·min(agility, 120) − 0.3978·MS  (max error 0.6 s)
 *    Agility above 120 does nothing in Citadel (Thunderhoof 120 = Wyrmshadow 133).
 * mult = 1 + (pet mastery bonus + evolution bonus) / 100. Pat does NOT apply to hunting stats
 * (user: pat does not boost movement speed). Evolution works like combat (user confirmed).
 */
import { PET_STATS, getPetMasteryBonus } from './pet-data';

type Growth = { base: number; perLevel: number };

/** Movement speed + max stamina per species (game data sheet, 2026-11-25). */
export const PET_HUNT_STATS: Record<string, { moveSpeed: Growth; stamina: Growth }> = {
  // Standard
  Fluffy: { moveSpeed: { base: 1, perLevel: 0.03 }, stamina: { base: 50, perLevel: 0.5 } },
  Shelly: { moveSpeed: { base: 0, perLevel: 0.015 }, stamina: { base: 50, perLevel: 0.5 } },
  Whiskers: { moveSpeed: { base: 1, perLevel: 0.03 }, stamina: { base: 50, perLevel: 0.5 } },
  Leafy: { moveSpeed: { base: 1, perLevel: 0.03 }, stamina: { base: 50, perLevel: 0.5 } },
  Aquastar: { moveSpeed: { base: 1, perLevel: 0.03 }, stamina: { base: 50, perLevel: 0.5 } },
  // Refined
  Aquarion: { moveSpeed: { base: 1, perLevel: 0.063 }, stamina: { base: 70, perLevel: 0.7 } },
  Furbella: { moveSpeed: { base: 1, perLevel: 0.072 }, stamina: { base: 70, perLevel: 0.7 } },
  Shadowscale: { moveSpeed: { base: 1, perLevel: 0.066 }, stamina: { base: 70, perLevel: 0.7 } },
  Nutwhisker: { moveSpeed: { base: 1, perLevel: 0.066 }, stamina: { base: 70, perLevel: 0.7 } },
  Stardust: { moveSpeed: { base: 1, perLevel: 0.075 }, stamina: { base: 70, perLevel: 0.7 } },
  Blooplord: { moveSpeed: { base: 1, perLevel: 0.069 }, stamina: { base: 70, perLevel: 0.7 } },
  Draconis: { moveSpeed: { base: 1, perLevel: 0.072 }, stamina: { base: 70, perLevel: 0.7 } },
  // Premium
  Wrex: { moveSpeed: { base: 1, perLevel: 0.132 }, stamina: { base: 90, perLevel: 0.9 } },
  Fangor: { moveSpeed: { base: 1, perLevel: 0.123 }, stamina: { base: 90, perLevel: 0.9 } },
  Raptora: { moveSpeed: { base: 1, perLevel: 0.129 }, stamina: { base: 90, perLevel: 0.9 } },
  Lumi: { moveSpeed: { base: 1, perLevel: 0.126 }, stamina: { base: 90, perLevel: 0.9 } },
  Zephyrix: { moveSpeed: { base: 1, perLevel: 0.135 }, stamina: { base: 90, perLevel: 0.9 } },
  Vexalia: { moveSpeed: { base: 1, perLevel: 0.135 }, stamina: { base: 90, perLevel: 0.9 } },
  // Epic
  Vulpina: { moveSpeed: { base: 2, perLevel: 0.165 }, stamina: { base: 120, perLevel: 1 } },
  Florien: { moveSpeed: { base: 2, perLevel: 0.15 }, stamina: { base: 120, perLevel: 1 } },
  Emberwhisp: { moveSpeed: { base: 2, perLevel: 0.15 }, stamina: { base: 120, perLevel: 1 } },
  Pyroflare: { moveSpeed: { base: 2, perLevel: 0.18 }, stamina: { base: 120, perLevel: 1 } },
  Aerion: { moveSpeed: { base: 2, perLevel: 0.18 }, stamina: { base: 120, perLevel: 1 } },
  Solarix: { moveSpeed: { base: 2, perLevel: 0.165 }, stamina: { base: 120, perLevel: 1 } },
  Starmane: { moveSpeed: { base: 2, perLevel: 0.165 }, stamina: { base: 120, perLevel: 1 } },
  // Legendary
  Leovar: { moveSpeed: { base: 2, perLevel: 0.195 }, stamina: { base: 150, perLevel: 1.2 } },
  Drakeling: { moveSpeed: { base: 2, perLevel: 0.195 }, stamina: { base: 150, perLevel: 1.2 } },
  Scalethorn: { moveSpeed: { base: 2, perLevel: 0.21 }, stamina: { base: 150, perLevel: 1.2 } },
  Sauronix: { moveSpeed: { base: 2, perLevel: 0.195 }, stamina: { base: 150, perLevel: 1.2 } },
  // Mythic
  Thunderhoof: { moveSpeed: { base: 2, perLevel: 0.225 }, stamina: { base: 200, perLevel: 1.5 } },
  Wyrmshadow: { moveSpeed: { base: 2, perLevel: 0.225 }, stamina: { base: 200, perLevel: 1.5 } },
  Orthrus: { moveSpeed: { base: 2, perLevel: 0.225 }, stamina: { base: 200, perLevel: 1.5 } },
  Lunark: { moveSpeed: { base: 2, perLevel: 0.23 }, stamina: { base: 200, perLevel: 1.5 } },
  Shardback: { moveSpeed: { base: 2, perLevel: 0.225 }, stamina: { base: 200, perLevel: 1.5 } },
  // Event (Epic)
  Ravenwing: { moveSpeed: { base: 2, perLevel: 0.18 }, stamina: { base: 120, perLevel: 1 } },
  Snowrunner: { moveSpeed: { base: 2, perLevel: 0.195 }, stamina: { base: 120, perLevel: 1 } },
  Lovebuzz: { moveSpeed: { base: 2, perLevel: 0.135 }, stamina: { base: 120, perLevel: 1 } },
  Thistlehop: { moveSpeed: { base: 2, perLevel: 0.165 }, stamina: { base: 120, perLevel: 1 } },
  Nyx: { moveSpeed: { base: 2, perLevel: 0.18 }, stamina: { base: 120, perLevel: 1 } },
  Wingsley: { moveSpeed: { base: 2, perLevel: 0.17 }, stamina: { base: 120, perLevel: 1 } },
  Nova: { moveSpeed: { base: 2, perLevel: 0.18 }, stamina: { base: 120, perLevel: 1 } },
  Ollo: { moveSpeed: { base: 1, perLevel: 0.05 }, stamina: { base: 120, perLevel: 1 } },
  Rattles: { moveSpeed: { base: 2, perLevel: 0.185 }, stamina: { base: 120, perLevel: 1 } },
  Nutmeg: { moveSpeed: { base: 2, perLevel: 0.19 }, stamina: { base: 120, perLevel: 1 } },
  Splash: { moveSpeed: { base: 2, perLevel: 0.18 }, stamina: { base: 120, perLevel: 1 } },
  Lumo: { moveSpeed: { base: 1, perLevel: 0.18 }, stamina: { base: 120, perLevel: 1 } },
  Gromley: { moveSpeed: { base: 1, perLevel: 0.12 }, stamina: { base: 120, perLevel: 1 } },
};

/** Base stamina drain per second, by pet quality (event pets drain like Epic). */
export const HUNT_DRAIN: Record<string, number> = {
  Standard: 0.025,
  Refined: 0.022,
  Premium: 0.019,
  Epic: 0.016,
  Legendary: 0.013,
  Mythic: 0.01,
};

/** Agility above this does nothing in Citadel (fitted; may differ per zone). */
export const CITADEL_AGILITY_CAP = 120;

/** Pets out at once — the same count hunts AND battles at the same time. +1 per 12.5 mastery levels. */
export function petSquadSize(petMasteryLevel: number): number {
  const m = Math.min(100, Math.max(1, Math.floor(petMasteryLevel || 1)));
  return 2 + Math.floor(m / 12.5);
}

export interface PetHuntEstimate {
  species: string;
  quality: string;
  level: number;
  agility: number;
  moveSpeed: number;
  maxStamina: number;
  huntSeconds: number;
  secondsPerEnemy: number;
  /** Citadel estimate — every other zone gives more. */
  citadelEncounters: number;
}

const at = (g: Growth, level: number) => g.base + (level - 1) * g.perLevel;

/** Hunting estimate from raw stat growths (used for built-in pets and admin previews). */
export function huntEstimateFromStats(
  species: string,
  quality: string,
  growth: { agility: Growth; moveSpeed: Growth; stamina: Growth },
  level: number,
  petMasteryLevel: number,
  evolution = 0
): PetHuntEstimate {
  const L = Math.min(100, Math.max(1, Math.floor(level || 1)));
  const mult = 1 + (getPetMasteryBonus(petMasteryLevel) + Math.min(5, Math.max(0, evolution)) * 5) / 100;
  const agility = Math.round(Math.floor(at(growth.agility, L) + 1e-9) * mult);
  const moveSpeed = Math.round(Math.round(at(growth.moveSpeed, L) * 10 + 1e-9) / 10 * mult * 100) / 100;
  const maxStamina = Math.floor(at(growth.stamina, L) + 1e-9);
  const huntSeconds = maxStamina / (HUNT_DRAIN[quality] ?? HUNT_DRAIN.Epic);
  const secondsPerEnemy = Math.max(30, 199.91 - 0.7237 * Math.min(agility, CITADEL_AGILITY_CAP) - 0.3978 * moveSpeed);
  return {
    species,
    quality,
    level: L,
    agility,
    moveSpeed,
    maxStamina,
    huntSeconds,
    secondsPerEnemy,
    citadelEncounters: Math.round(huntSeconds / secondsPerEnemy),
  };
}

/** Returns null for species we have no hunting data for. */
export function petHuntEstimate(
  species: string,
  level: number,
  petMasteryLevel: number,
  evolution = 0
): PetHuntEstimate | null {
  const hunt = PET_HUNT_STATS[species];
  const combat = PET_STATS[species];
  if (!hunt || !combat) return null;
  return huntEstimateFromStats(
    species,
    combat.quality,
    { agility: combat.agility, moveSpeed: hunt.moveSpeed, stamina: hunt.stamina },
    level,
    petMasteryLevel,
    evolution
  );
}

/**
 * Pets that hunt well together: a squad hunts, then sleeps to recover stamina (sleep takes longer
 * than the hunt), so two rotating groups are needed. The roster evaluates the best 20 pets (user).
 */
export const HUNT_STABLE_SIZE = 20;

/** Hunt power: sum of Citadel encounters per hunt over the best `size` pets. */
export function squadHuntPower(
  pets: { species: string | null; level: number; evolution?: number }[],
  petMasteryLevel: number,
  size: number = petSquadSize(petMasteryLevel)
): { power: number; squad: PetHuntEstimate[]; size: number } {
  const estimates = pets
    .map((p) => (p.species ? petHuntEstimate(p.species, p.level, petMasteryLevel, p.evolution ?? 0) : null))
    .filter((e): e is PetHuntEstimate => e !== null)
    .sort((a, b) => b.citadelEncounters - a.citadelEncounters);
  const squad = estimates.slice(0, size);
  return { power: squad.reduce((s, e) => s + e.citadelEncounters, 0), squad, size };
}
