/**
 * IdleMMO scheduled raids. Static game data; min_cl = combat level needed to join.
 *
 * Each raid guild runs one raid (some lower guilds run several). Assault guilds
 * (guilds.is_assault: DE, DI) run no raids; they take CL 100+. Which raids a guild runs
 * lives in guild_config.settings.raids (array of keys). When unset, the default is
 * the raid whose CL requirement matches the guild's min_level.
 */
export interface Raid {
  key: string;
  name: string;
  location: string;
  minutes: number;
  marks: number;
  min_cl: number;
}

export const RAIDS: Raid[] = [
  { key: 'barnyard-abyss', name: 'Barnyard Abyss', location: 'Bluebell Hollow', minutes: 30, marks: 2, min_cl: 1 },
  { key: 'whisperwood-siege', name: 'Whisperwood Seige' /* game spelling */, location: 'Whispering Woods', minutes: 33, marks: 2, min_cl: 12 },
  { key: 'crystal-echoes', name: 'Crystal Echoes', location: 'Crystal Caverns', minutes: 38, marks: 2, min_cl: 25 },
  { key: 'frostbite-summit', name: 'Frostbite Summit', location: 'Skyreach Peak', minutes: 43, marks: 3, min_cl: 40 },
  { key: 'dunekeepers-last-stand', name: "Dunekeeper's Last Stand", location: 'Enchanted Oasis', minutes: 48, marks: 3, min_cl: 60 },
  { key: 'skybound-eden', name: 'Skybound Eden', location: 'Floating Gardens of Aetheria', minutes: 55, marks: 3, min_cl: 70 },
  { key: 'orbit-of-the-forgotten', name: 'Orbit of the Forgotten', location: 'Celestial Observatory', minutes: 60, marks: 4, min_cl: 80 },
  { key: 'the-silent-watchers', name: 'The Silent Watchers', location: 'Isle of Whispers', minutes: 67, marks: 4, min_cl: 92 },
];

export const RAID_BY_KEY = new Map(RAIDS.map((r) => [r.key, r]));

/** Highest raid a combat level can join. */
export function bestRaidFor(cl: number): Raid | null {
  return [...RAIDS].reverse().find((r) => cl >= r.min_cl) ?? null;
}

/** Raids a guild runs: explicit setting, else the raid matching its min level. */
export function guildRaids(settings: { raids?: unknown } | null | undefined, minLevel: number | null | undefined): Raid[] {
  const keys = Array.isArray(settings?.raids) ? (settings!.raids as unknown[]).filter((k): k is string => typeof k === 'string') : [];
  const explicit = keys.map((k) => RAID_BY_KEY.get(k)).filter((r): r is Raid => !!r);
  if (explicit.length) return explicit.sort((a, b) => a.min_cl - b.min_cl);
  const match = RAIDS.find((r) => r.min_cl === (minLevel ?? -1));
  return match ? [match] : [];
}

/** Dream Engineers: assault entry guild (no level gate in game; we point CL 100 / top of ladder here). */
export const ASSAULT_ENTRY_GUILD_ID = '1184';
/** Dream Invaders: hardcore assaults, reached by moving up from DE, not by level. */
export const ASSAULT_TOP_GUILD_ID = '138';
/** Assault guilds (DE, DI) don't run raids; they nominally take CL 100+. */
export const ASSAULT_MIN_CL = 100;
