export interface PetBaseStats {
  name: string;
  quality: string;
  agility: { base: number; perLevel: number };
  accuracy: { base: number; perLevel: number };
  protection: { base: number; perLevel: number };
  attackPower: { base: number; perLevel: number };
}

/**
 * All Chapter II pet stats from the game data.
 * Formula: stat_at_level = base + (level - 1) * perLevel
 */
export const PET_STATS: Record<string, PetBaseStats> = {
  // ── Standard ──
  Fluffy: { name: "Fluffy", quality: "Standard", agility: { base: 1, perLevel: 0.29 }, accuracy: { base: 1, perLevel: 0.29 }, protection: { base: 4, perLevel: 0.29 }, attackPower: { base: 4, perLevel: 0.29 } },
  Shelly: { name: "Shelly", quality: "Standard", agility: { base: 1, perLevel: 0.12 }, accuracy: { base: 1, perLevel: 0.29 }, protection: { base: 4, perLevel: 0.29 }, attackPower: { base: 4, perLevel: 0.29 } },
  Whiskers: { name: "Whiskers", quality: "Standard", agility: { base: 1, perLevel: 0.4 }, accuracy: { base: 1, perLevel: 0.17 }, protection: { base: 4, perLevel: 0.29 }, attackPower: { base: 4, perLevel: 0.29 } },
  Leafy: { name: "Leafy", quality: "Standard", agility: { base: 1, perLevel: 0.29 }, accuracy: { base: 1, perLevel: 0.29 }, protection: { base: 4, perLevel: 0.29 }, attackPower: { base: 4, perLevel: 0.29 } },
  Aquastar: { name: "Aquastar", quality: "Standard", agility: { base: 1, perLevel: 0.29 }, accuracy: { base: 1, perLevel: 0.29 }, protection: { base: 4, perLevel: 0.29 }, attackPower: { base: 4, perLevel: 0.29 } },

  // ── Refined ──
  Aquarion: { name: "Aquarion", quality: "Refined", agility: { base: 2, perLevel: 0.4 }, accuracy: { base: 2, perLevel: 0.4 }, protection: { base: 4, perLevel: 0.4 }, attackPower: { base: 6, perLevel: 0.4 } },
  Furbella: { name: "Furbella", quality: "Refined", agility: { base: 2, perLevel: 0.12 }, accuracy: { base: 2, perLevel: 0.58 }, protection: { base: 4, perLevel: 0.38 }, attackPower: { base: 6, perLevel: 0.43 } },
  Shadowscale: { name: "Shadowscale", quality: "Refined", agility: { base: 2, perLevel: 0.46 }, accuracy: { base: 2, perLevel: 0.58 }, protection: { base: 4, perLevel: 0.23 }, attackPower: { base: 6, perLevel: 0.23 } },
  Nutwhisker: { name: "Nutwhisker", quality: "Refined", agility: { base: 2, perLevel: 0.29 }, accuracy: { base: 2, perLevel: 0.63 }, protection: { base: 4, perLevel: 0.29 }, attackPower: { base: 6, perLevel: 0.29 } },
  Stardust: { name: "Stardust", quality: "Refined", agility: { base: 2, perLevel: 0.23 }, accuracy: { base: 2, perLevel: 0.29 }, protection: { base: 4, perLevel: 0.39 }, attackPower: { base: 6, perLevel: 0.35 } },
  Blooplord: { name: "Blooplord", quality: "Refined", agility: { base: 2, perLevel: 0.35 }, accuracy: { base: 2, perLevel: 0.35 }, protection: { base: 4, perLevel: 0.23 }, attackPower: { base: 6, perLevel: 0.46 } },
  Draconis: { name: "Draconis", quality: "Refined", agility: { base: 2, perLevel: 0.35 }, accuracy: { base: 2, perLevel: 0.35 }, protection: { base: 4, perLevel: 0.4 }, attackPower: { base: 6, perLevel: 0.4 } },

  // ── Premium ──
  Wrex: { name: "Wrex", quality: "Premium", agility: { base: 3, perLevel: 0.81 }, accuracy: { base: 3, perLevel: 0.46 }, protection: { base: 5, perLevel: 0.52 }, attackPower: { base: 7, perLevel: 0.52 } },
  Fangor: { name: "Fangor", quality: "Premium", agility: { base: 3, perLevel: 0.75 }, accuracy: { base: 3, perLevel: 0.63 }, protection: { base: 5, perLevel: 0.54 }, attackPower: { base: 7, perLevel: 0.49 } },
  Raptora: { name: "Raptora", quality: "Premium", agility: { base: 3, perLevel: 0.63 }, accuracy: { base: 3, perLevel: 0.63 }, protection: { base: 5, perLevel: 0.52 }, attackPower: { base: 7, perLevel: 0.52 } },
  Lumi: { name: "Lumi", quality: "Premium", agility: { base: 3, perLevel: 0.69 }, accuracy: { base: 3, perLevel: 0.4 }, protection: { base: 5, perLevel: 0.4 }, attackPower: { base: 7, perLevel: 0.63 } },
  Zephyrix: { name: "Zephyrix", quality: "Premium", agility: { base: 3, perLevel: 0.75 }, accuracy: { base: 3, perLevel: 0.75 }, protection: { base: 5, perLevel: 0.4 }, attackPower: { base: 7, perLevel: 0.4 } },
  Vexalia: { name: "Vexalia", quality: "Premium", agility: { base: 3, perLevel: 0.52 }, accuracy: { base: 3, perLevel: 0.75 }, protection: { base: 5, perLevel: 0.4 }, attackPower: { base: 7, perLevel: 0.63 } },

  // ── Epic ──
  Vulpina: { name: "Vulpina", quality: "Epic", agility: { base: 4, perLevel: 0.92 }, accuracy: { base: 4, perLevel: 0.81 }, protection: { base: 5, perLevel: 0.4 }, attackPower: { base: 8, perLevel: 0.52 } },
  Florien: { name: "Florien", quality: "Epic", agility: { base: 4, perLevel: 0.7 }, accuracy: { base: 4, perLevel: 0.79 }, protection: { base: 5, perLevel: 0.61 }, attackPower: { base: 8, perLevel: 0.59 } },
  Emberwhisp: { name: "Emberwhisp", quality: "Epic", agility: { base: 4, perLevel: 0.62 }, accuracy: { base: 4, perLevel: 0.68 }, protection: { base: 5, perLevel: 0.6 }, attackPower: { base: 8, perLevel: 0.67 } },
  Pyroflare: { name: "Pyroflare", quality: "Epic", agility: { base: 4, perLevel: 0.63 }, accuracy: { base: 4, perLevel: 0.6 }, protection: { base: 5, perLevel: 0.63 }, attackPower: { base: 8, perLevel: 0.69 } },
  Aerion: { name: "Aerion", quality: "Epic", agility: { base: 4, perLevel: 0.63 }, accuracy: { base: 4, perLevel: 0.63 }, protection: { base: 5, perLevel: 0.75 }, attackPower: { base: 8, perLevel: 0.69 } },
  Solarix: { name: "Solarix", quality: "Epic", agility: { base: 4, perLevel: 0.81 }, accuracy: { base: 4, perLevel: 0.81 }, protection: { base: 5, perLevel: 0.63 }, attackPower: { base: 8, perLevel: 0.52 } },
  Starmane: { name: "Starmane", quality: "Epic", agility: { base: 4, perLevel: 0.69 }, accuracy: { base: 4, perLevel: 0.46 }, protection: { base: 5, perLevel: 0.86 }, attackPower: { base: 8, perLevel: 0.52 } },

  // ── Legendary ──
  Leovar: { name: "Leovar", quality: "Legendary", agility: { base: 6, perLevel: 0.98 }, accuracy: { base: 6, perLevel: 0.75 }, protection: { base: 7, perLevel: 0.58 }, attackPower: { base: 7, perLevel: 0.75 } },
  Drakeling: { name: "Drakeling", quality: "Legendary", agility: { base: 6, perLevel: 0.9 }, accuracy: { base: 6, perLevel: 0.69 }, protection: { base: 7, perLevel: 0.58 }, attackPower: { base: 7, perLevel: 0.75 } },
  Scalethorn: { name: "Scalethorn", quality: "Legendary", agility: { base: 6, perLevel: 0.98 }, accuracy: { base: 6, perLevel: 0.92 }, protection: { base: 7, perLevel: 0.71 }, attackPower: { base: 7, perLevel: 0.63 } },
  Sauronix: { name: "Sauronix", quality: "Legendary", agility: { base: 6, perLevel: 0.81 }, accuracy: { base: 6, perLevel: 0.84 }, protection: { base: 7, perLevel: 0.71 }, attackPower: { base: 7, perLevel: 0.7 } },

  // ── Mythic ──
  Thunderhoof: { name: "Thunderhoof", quality: "Mythic", agility: { base: 9, perLevel: 0.92 }, accuracy: { base: 9, perLevel: 1.04 }, protection: { base: 9, perLevel: 0.92 }, attackPower: { base: 9, perLevel: 0.81 } },
  Wyrmshadow: { name: "Wyrmshadow", quality: "Mythic", agility: { base: 9, perLevel: 1.04 }, accuracy: { base: 9, perLevel: 0.92 }, protection: { base: 9, perLevel: 0.81 }, attackPower: { base: 9, perLevel: 0.92 } },
  Orthrus: { name: "Orthrus", quality: "Mythic", agility: { base: 9, perLevel: 0.92 }, accuracy: { base: 9, perLevel: 0.98 }, protection: { base: 9, perLevel: 0.87 }, attackPower: { base: 9, perLevel: 0.91 } },
  Lunark: { name: "Lunark", quality: "Mythic", agility: { base: 9, perLevel: 0.96 }, accuracy: { base: 9, perLevel: 0.99 }, protection: { base: 9, perLevel: 0.85 }, attackPower: { base: 9, perLevel: 0.87 } },
  Shardback: { name: "Shardback", quality: "Mythic", agility: { base: 9, perLevel: 0.81 }, accuracy: { base: 9, perLevel: 0.92 }, protection: { base: 9, perLevel: 1.04 }, attackPower: { base: 9, perLevel: 0.92 } },

  // ── Event Pets (Epic) ──
  Ravenwing: { name: "Ravenwing", quality: "Epic", agility: { base: 6, perLevel: 0.67 }, accuracy: { base: 6, perLevel: 0.6 }, protection: { base: 7, perLevel: 0.43 }, attackPower: { base: 8, perLevel: 0.54 } },
  Snowrunner: { name: "Snowrunner", quality: "Epic", agility: { base: 6, perLevel: 0.75 }, accuracy: { base: 6, perLevel: 0.81 }, protection: { base: 7, perLevel: 0.46 }, attackPower: { base: 7, perLevel: 0.52 } },
  Lovebuzz: { name: "Lovebuzz", quality: "Epic", agility: { base: 6, perLevel: 0.75 }, accuracy: { base: 6, perLevel: 0.58 }, protection: { base: 7, perLevel: 0.46 }, attackPower: { base: 7, perLevel: 0.4 } },
  Thistlehop: { name: "Thistlehop", quality: "Epic", agility: { base: 6, perLevel: 0.86 }, accuracy: { base: 6, perLevel: 0.58 }, protection: { base: 7, perLevel: 0.46 }, attackPower: { base: 7, perLevel: 0.35 } },
  Nyx: { name: "Nyx", quality: "Epic", agility: { base: 6, perLevel: 0.77 }, accuracy: { base: 6, perLevel: 0.63 }, protection: { base: 6, perLevel: 0.35 }, attackPower: { base: 8, perLevel: 0.48 } },
  Wingsley: { name: "Wingsley", quality: "Epic", agility: { base: 6, perLevel: 0.72 }, accuracy: { base: 6, perLevel: 0.6 }, protection: { base: 6, perLevel: 0.4 }, attackPower: { base: 8, perLevel: 0.55 } },
  Nova: { name: "Nova", quality: "Epic", agility: { base: 6, perLevel: 0.7 }, accuracy: { base: 6, perLevel: 0.54 }, protection: { base: 7, perLevel: 0.42 }, attackPower: { base: 8, perLevel: 0.6 } },
  Ollo: { name: "Ollo", quality: "Epic", agility: { base: 3, perLevel: 0.2 }, accuracy: { base: 6, perLevel: 0.74 }, protection: { base: 7, perLevel: 0.65 }, attackPower: { base: 8, perLevel: 0.65 } },
  Rattles: { name: "Rattles", quality: "Epic", agility: { base: 3, perLevel: 0.52 }, accuracy: { base: 6, perLevel: 0.54 }, protection: { base: 7, perLevel: 0.55 }, attackPower: { base: 7, perLevel: 0.65 } },
  Nutmeg: { name: "Nutmeg", quality: "Epic", agility: { base: 3, perLevel: 0.6 }, accuracy: { base: 6, perLevel: 0.54 }, protection: { base: 7, perLevel: 0.5 }, attackPower: { base: 7, perLevel: 0.62 } },
  Splash: { name: "Splash", quality: "Epic", agility: { base: 3, perLevel: 0.66 }, accuracy: { base: 6, perLevel: 0.56 }, protection: { base: 7, perLevel: 0.44 }, attackPower: { base: 7, perLevel: 0.59 } },
  Lumo: { name: "Lumo", quality: "Epic", agility: { base: 3, perLevel: 0.68 }, accuracy: { base: 6, perLevel: 0.61 }, protection: { base: 7, perLevel: 0.35 }, attackPower: { base: 8, perLevel: 0.61 } },
  Gromley: { name: "Gromley", quality: "Epic", agility: { base: 3, perLevel: 0.45 }, accuracy: { base: 6, perLevel: 0.6 }, protection: { base: 7, perLevel: 0.5 }, attackPower: { base: 8, perLevel: 0.7 } },
};

/**
 * Pet mastery bonus table.
 * Mastery level 44-100 grants a percentage boost to all pet stats.
 */
const MASTERY_TABLE: Record<number, number> = {
  44: 1, 45: 1, 46: 1, 47: 1, 48: 1, 49: 1, 50: 1, 51: 1, 52: 1,
  53: 2, 54: 2, 55: 2, 56: 2, 57: 2, 58: 2,
  59: 3, 60: 3, 61: 3, 62: 3, 63: 3,
  64: 4, 65: 4, 66: 4,
  67: 5, 68: 5, 69: 5, 70: 5,
  71: 6, 72: 6, 73: 6,
  74: 7, 75: 7, 76: 7,
  77: 8, 78: 8,
  79: 9, 80: 9, 81: 9,
  82: 10, 83: 10,
  84: 11, 85: 11,
  86: 12, 87: 12,
  88: 13, 89: 13,
  90: 14, 91: 14,
  92: 15,
  93: 16, 94: 16,
  95: 17, 96: 17,
  97: 18,
  98: 19, 99: 19,
  100: 20,
};

export function getPetMasteryBonus(masteryLevel: number): number {
  if (masteryLevel < 44) return 0;
  if (masteryLevel > 100) return 20;
  return MASTERY_TABLE[masteryLevel] ?? 0;
}

/**
 * Maps known image filename stems to their PET_STATS species name.
 * Only needed when the filename doesn't match the species name directly.
 * If a pet's CDN URL ever changes back to use the species name as the filename,
 * the capitalised-stem fallback in petSpeciesFromImageUrl still handles it.
 */
const FILE_STEM_TO_SPECIES: Record<string, string> = {
  // Epic
  flower: "Florien",
  "fire ball": "Pyroflare",
  monster: "Solarix",
  fox: "Vulpina",
  // Legendary (dragon-numbered filenames)
  "dragon 1": "Scalethorn",
  "dragon 3": "Sauronix",
  "dragon 6": "Drakeling",
};

/**
 * Extracts the pet species name from an IdleMMO image URL.
 * The URL encodes the original filename in base64, e.g.:
 *   ....-metabGVvdmFyLnBuZw==-.png  →  "leovar.png"  →  "Leovar"
 * Returns null if the decoded name is not a known species in PET_STATS.
 */
export function petSpeciesFromImageUrl(imageUrl: string | null | undefined): string | null {
  if (!imageUrl) return null;
  const match = imageUrl.match(/-meta([A-Za-z0-9+/=]+)-\./);
  if (!match) return null;
  try {
    const filename = atob(match[1]);
    const basename = filename.replace(/\.[^.]+$/, "").toLowerCase();
    // Check explicit filename→species overrides first
    if (FILE_STEM_TO_SPECIES[basename]) return FILE_STEM_TO_SPECIES[basename];
    // Fall back to capitalised stem if it matches a known species
    const candidate = basename.charAt(0).toUpperCase() + basename.slice(1);
    return PET_STATS[candidate] ? candidate : null;
  } catch {
    return null;
  }
}

/**
 * Resolves the species name for a pet given its display name and optional image URL.
 * Priority: direct PET_STATS match on name → image URL decode → null (unknown).
 */
export function resolveSpeciesName(name: string, imageUrl?: string | null): string | null {
  if (PET_STATS[name]) return name;
  return petSpeciesFromImageUrl(imageUrl);
}

/** Crit damage / crit chance / max health per pet (Chapter II pet stats sheet). stat = base + (level-1) * perLevel */
export const PET_EXTRA: Record<string, { critDamage: { base: number; perLevel: number }; critChance: { base: number; perLevel: number }; maxHealth: { base: number; perLevel: number } }> = {
  Fluffy: { critDamage: { base: 2, perLevel: 0.12 }, critChance: { base: 3, perLevel: 0 }, maxHealth: { base: 50, perLevel: 10 } },
  Shelly: { critDamage: { base: 2, perLevel: 0.12 }, critChance: { base: 3, perLevel: 0 }, maxHealth: { base: 50, perLevel: 10 } },
  Whiskers: { critDamage: { base: 2, perLevel: 0.12 }, critChance: { base: 3, perLevel: 0 }, maxHealth: { base: 50, perLevel: 10 } },
  Leafy: { critDamage: { base: 2, perLevel: 0.12 }, critChance: { base: 3, perLevel: 0 }, maxHealth: { base: 50, perLevel: 10 } },
  Aquastar: { critDamage: { base: 2, perLevel: 0.12 }, critChance: { base: 3, perLevel: 0 }, maxHealth: { base: 50, perLevel: 10 } },
  Aquarion: { critDamage: { base: 2, perLevel: 0.23 }, critChance: { base: 4, perLevel: 0 }, maxHealth: { base: 65, perLevel: 13 } },
  Furbella: { critDamage: { base: 2, perLevel: 0.23 }, critChance: { base: 4, perLevel: 0 }, maxHealth: { base: 65, perLevel: 13 } },
  Shadowscale: { critDamage: { base: 2, perLevel: 0.23 }, critChance: { base: 4, perLevel: 0 }, maxHealth: { base: 65, perLevel: 13 } },
  Nutwhisker: { critDamage: { base: 2, perLevel: 0.23 }, critChance: { base: 4, perLevel: 0 }, maxHealth: { base: 65, perLevel: 13 } },
  Stardust: { critDamage: { base: 2, perLevel: 0.23 }, critChance: { base: 4, perLevel: 0 }, maxHealth: { base: 65, perLevel: 13 } },
  Blooplord: { critDamage: { base: 2, perLevel: 0.23 }, critChance: { base: 4, perLevel: 0 }, maxHealth: { base: 65, perLevel: 13 } },
  Draconis: { critDamage: { base: 2, perLevel: 0.23 }, critChance: { base: 4, perLevel: 0 }, maxHealth: { base: 65, perLevel: 13 } },
  Wrex: { critDamage: { base: 2, perLevel: 0.29 }, critChance: { base: 5, perLevel: 0 }, maxHealth: { base: 70, perLevel: 14 } },
  Fangor: { critDamage: { base: 2, perLevel: 0.29 }, critChance: { base: 5, perLevel: 0 }, maxHealth: { base: 70, perLevel: 14 } },
  Raptora: { critDamage: { base: 2, perLevel: 0.29 }, critChance: { base: 5, perLevel: 0 }, maxHealth: { base: 70, perLevel: 14 } },
  Lumi: { critDamage: { base: 2, perLevel: 0.29 }, critChance: { base: 5, perLevel: 0 }, maxHealth: { base: 70, perLevel: 14 } },
  Zephyrix: { critDamage: { base: 2, perLevel: 0.29 }, critChance: { base: 5, perLevel: 0 }, maxHealth: { base: 70, perLevel: 14 } },
  Vexalia: { critDamage: { base: 2, perLevel: 0.29 }, critChance: { base: 5, perLevel: 0 }, maxHealth: { base: 70, perLevel: 14 } },
  Vulpina: { critDamage: { base: 3, perLevel: 0.35 }, critChance: { base: 7, perLevel: 0 }, maxHealth: { base: 70, perLevel: 16 } },
  Florien: { critDamage: { base: 3, perLevel: 0.35 }, critChance: { base: 7, perLevel: 0 }, maxHealth: { base: 70, perLevel: 16 } },
  Emberwhisp: { critDamage: { base: 3, perLevel: 0.35 }, critChance: { base: 7, perLevel: 0 }, maxHealth: { base: 70, perLevel: 16 } },
  Pyroflare: { critDamage: { base: 3, perLevel: 0.35 }, critChance: { base: 7, perLevel: 0 }, maxHealth: { base: 70, perLevel: 16 } },
  Aerion: { critDamage: { base: 3, perLevel: 0.35 }, critChance: { base: 7, perLevel: 0 }, maxHealth: { base: 70, perLevel: 16 } },
  Solarix: { critDamage: { base: 3, perLevel: 0.35 }, critChance: { base: 7, perLevel: 0 }, maxHealth: { base: 70, perLevel: 16 } },
  Starmane: { critDamage: { base: 3, perLevel: 0.35 }, critChance: { base: 7, perLevel: 0 }, maxHealth: { base: 70, perLevel: 16 } },
  Leovar: { critDamage: { base: 4, perLevel: 0.39 }, critChance: { base: 9, perLevel: 0 }, maxHealth: { base: 85, perLevel: 16 } },
  Drakeling: { critDamage: { base: 4, perLevel: 0.39 }, critChance: { base: 9, perLevel: 0 }, maxHealth: { base: 85, perLevel: 16 } },
  Scalethorn: { critDamage: { base: 4, perLevel: 0.39 }, critChance: { base: 9, perLevel: 0 }, maxHealth: { base: 85, perLevel: 16 } },
  Sauronix: { critDamage: { base: 4, perLevel: 0.39 }, critChance: { base: 9, perLevel: 0 }, maxHealth: { base: 85, perLevel: 16 } },
  Thunderhoof: { critDamage: { base: 4, perLevel: 0.45 }, critChance: { base: 12, perLevel: 0 }, maxHealth: { base: 150, perLevel: 20 } },
  Wyrmshadow: { critDamage: { base: 4, perLevel: 0.45 }, critChance: { base: 12, perLevel: 0 }, maxHealth: { base: 150, perLevel: 20 } },
  Orthrus: { critDamage: { base: 4, perLevel: 0.45 }, critChance: { base: 12, perLevel: 0 }, maxHealth: { base: 150, perLevel: 20 } },
  Lunark: { critDamage: { base: 4, perLevel: 0.45 }, critChance: { base: 12, perLevel: 0 }, maxHealth: { base: 150, perLevel: 20 } },
  Ravenwing: { critDamage: { base: 3, perLevel: 0.36 }, critChance: { base: 7, perLevel: 0 }, maxHealth: { base: 85, perLevel: 16 } },
  Snowrunner: { critDamage: { base: 4, perLevel: 0.35 }, critChance: { base: 7, perLevel: 0 }, maxHealth: { base: 85, perLevel: 20 } },
  Lovebuzz: { critDamage: { base: 3, perLevel: 0.35 }, critChance: { base: 7, perLevel: 0 }, maxHealth: { base: 85, perLevel: 15 } },
  Thistlehop: { critDamage: { base: 3, perLevel: 0.35 }, critChance: { base: 7, perLevel: 0 }, maxHealth: { base: 85, perLevel: 15 } },
  Nyx: { critDamage: { base: 3, perLevel: 0.35 }, critChance: { base: 7, perLevel: 0 }, maxHealth: { base: 85, perLevel: 15 } },
  Wingsley: { critDamage: { base: 3, perLevel: 0.35 }, critChance: { base: 7, perLevel: 0 }, maxHealth: { base: 85, perLevel: 15 } },
  Nova: { critDamage: { base: 4, perLevel: 0.36 }, critChance: { base: 7, perLevel: 0 }, maxHealth: { base: 85, perLevel: 16 } },
  Ollo: { critDamage: { base: 4, perLevel: 0.4 }, critChance: { base: 7, perLevel: 0.01 }, maxHealth: { base: 85, perLevel: 15 } },
  Rattles: { critDamage: { base: 4, perLevel: 0.4 }, critChance: { base: 7, perLevel: 0.01 }, maxHealth: { base: 85, perLevel: 15 } },
  Nutmeg: { critDamage: { base: 4, perLevel: 0.4 }, critChance: { base: 7, perLevel: 0.01 }, maxHealth: { base: 85, perLevel: 15 } },
  Gromley: { critDamage: { base: 4, perLevel: 0.41 }, critChance: { base: 7, perLevel: 0.01 }, maxHealth: { base: 85, perLevel: 16 } },
};

/** Pets missing from the sheet's crit/HP columns fall back to the first pet of the same quality. */
function petExtra(name: string) {
  const direct = PET_EXTRA[name];
  if (direct) return direct;
  const q = PET_STATS[name]?.quality;
  const same = Object.keys(PET_STATS).find((n) => PET_STATS[n].quality === q && PET_EXTRA[n]);
  return same ? PET_EXTRA[same] : null;
}

export interface PetCombatStats {
  agility: number;
  accuracy: number;
  protection: number;
  attackPower: number;
  critDamage: number;
  critChance: number;
  maxHealth: number;
  multiplier: number;
}

/**
 * Pet combat stats at a given level with mastery bonus, pat (+5%) and evolution (+5% per stage).
 * In-game rounding: the levelled stat is floored first, then the bonus multiplier applied and rounded.
 * The multiplier applies to AP/Prot/Agi/Acc only — not crit damage, crit chance or max HP.
 * (Verified: Shardback L80, mastery 100, patted → Agi/Acc/AP 1 lower than round(raw × mult); Prot unchanged.)
 */
export function calculatePetCombatStats(
  petName: string,
  petLevel: number,
  masteryLevel: number,
  isPatted: boolean,
  evolutionLevel: number = 0
): PetCombatStats | null {
  const name = petName.trim();
  const petData = PET_STATS[name];
  if (!petData) return null;

  const masteryBonus = getPetMasteryBonus(masteryLevel);
  const patBonus = isPatted ? 5 : 0;
  const evoBonus = Math.min(5, Math.max(0, evolutionLevel)) * 5;
  const multiplier = 1 + (masteryBonus + patBonus + evoBonus) / 100;

  const level = Math.max(1, petLevel);
  const at = (s: { base: number; perLevel: number }) => Math.floor(s.base + (level - 1) * s.perLevel + 1e-9);
  const boosted = (s: { base: number; perLevel: number }) => Math.round(at(s) * multiplier);
  const ex = petExtra(name);

  return {
    agility: boosted(petData.agility),
    accuracy: boosted(petData.accuracy),
    protection: boosted(petData.protection),
    attackPower: boosted(petData.attackPower),
    // Mastery / pat / evolution don't buff crit damage, crit chance or max HP
    // (verified: Shardback L80 shows 39 crit damage in game = floor(4 + 79 × 0.45)).
    critDamage: ex ? at(ex.critDamage) : 0,
    critChance: ex ? at(ex.critChance) : 0,
    maxHealth: ex ? at(ex.maxHealth) : 0,
    multiplier,
  };
}
