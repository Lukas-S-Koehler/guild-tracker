/**
 * Static hunting upgrade data for the Assault Roster (docs/assault-roster.md §3.2).
 * Prices are NOT stored here: tradeable items are priced by name through `market_cache`
 * (price-cache-sync cron). Mythic eggs never trade, so they carry a fixed estimate.
 */

export interface HuntingBow {
  name: string;
  quality: 'Legendary' | 'Mythic';
  /** Hunt efficiency %. Fixed: upgrading the bow's tier does not change it. */
  huntEff: number;
  /** Required combat level. */
  combatLevel: number;
  /** Required dexterity (bows need DEX; swords/daggers STR; everything else DEF). */
  dexterity: number;
}

export const HUNTING_BOWS: HuntingBow[] = [
  { name: 'Whisperwind Bow', quality: 'Legendary', huntEff: 5, combatLevel: 60, dexterity: 50 },
  { name: 'Stormcaster', quality: 'Legendary', huntEff: 5, combatLevel: 61, dexterity: 50 },
  { name: 'Shadow Shot', quality: 'Legendary', huntEff: 5, combatLevel: 63, dexterity: 50 },
  { name: 'Frostbite Shot', quality: 'Legendary', huntEff: 5, combatLevel: 64, dexterity: 50 },
  { name: "Serpent's Arrow", quality: 'Legendary', huntEff: 5, combatLevel: 65, dexterity: 50 },
  { name: 'Viper', quality: 'Legendary', huntEff: 5, combatLevel: 67, dexterity: 50 },
  { name: 'Moonshot', quality: 'Legendary', huntEff: 5, combatLevel: 72, dexterity: 60 },
  { name: 'Stormsong', quality: 'Legendary', huntEff: 5, combatLevel: 74, dexterity: 60 },
  { name: 'Emberheart', quality: 'Legendary', huntEff: 6, combatLevel: 76, dexterity: 60 },
  { name: 'Piercer', quality: 'Legendary', huntEff: 7, combatLevel: 77, dexterity: 60 },
  { name: 'Sunseeker', quality: 'Legendary', huntEff: 8, combatLevel: 78, dexterity: 60 },
  { name: 'Thundershot', quality: 'Legendary', huntEff: 9, combatLevel: 79, dexterity: 60 },
  { name: 'Nightshade Bow', quality: 'Legendary', huntEff: 10, combatLevel: 80, dexterity: 70 },
  { name: 'Dawnbreaker Bow', quality: 'Legendary', huntEff: 11, combatLevel: 81, dexterity: 70 },
  { name: 'Ashenwind', quality: 'Legendary', huntEff: 12, combatLevel: 83, dexterity: 70 },
  { name: 'Starshower', quality: 'Legendary', huntEff: 13, combatLevel: 84, dexterity: 70 },
  { name: 'Fury', quality: 'Legendary', huntEff: 14, combatLevel: 86, dexterity: 70 },
  { name: 'Grimwood', quality: 'Legendary', huntEff: 15, combatLevel: 88, dexterity: 70 },
  { name: 'Silverthorn Bow', quality: 'Mythic', huntEff: 16, combatLevel: 90, dexterity: 80 },
  { name: 'Bloodmoon Bow', quality: 'Mythic', huntEff: 17, combatLevel: 91, dexterity: 80 },
  { name: "Death's Touch", quality: 'Mythic', huntEff: 18, combatLevel: 92, dexterity: 80 },
  { name: 'Soulstring', quality: 'Mythic', huntEff: 19, combatLevel: 93, dexterity: 80 },
  { name: 'Archdemon', quality: 'Mythic', huntEff: 19, combatLevel: 94, dexterity: 80 },
  { name: 'Sting', quality: 'Mythic', huntEff: 20, combatLevel: 95, dexterity: 80 },
  { name: 'Divinity', quality: 'Mythic', huntEff: 20, combatLevel: 96, dexterity: 80 },
];

export const huntingBow = (name: string | null | undefined) =>
  name ? HUNTING_BOWS.find((b) => b.name.toLowerCase() === name.toLowerCase()) ?? null : null;

/** Can this character equip the bow? Returns the missing requirement, or null when equippable. */
export function bowBlocker(bow: HuntingBow, combatLevel: number, dexterity: number): string | null {
  if (combatLevel < bow.combatLevel) return `needs CL ${bow.combatLevel}`;
  if (dexterity < bow.dexterity) return `needs DEX ${bow.dexterity}`;
  return null;
}

/**
 * Pet eggs. `market` = priced by name ("<Species> Egg") from market_cache;
 * `fixed` = never trades, use `estimate`; `none` = no listings, never suggest.
 */
export type EggPricing = { kind: 'market' } | { kind: 'fixed'; estimate: number } | { kind: 'none' };

export const MYTHIC_EGG_ESTIMATE = 20_000_000;

export const PET_EGGS: Record<string, EggPricing> = {
  Aquastar: { kind: 'market' }, Fluffy: { kind: 'market' }, Leafy: { kind: 'market' },
  Shelly: { kind: 'market' }, Whiskers: { kind: 'market' },
  Aquarion: { kind: 'market' }, Blooplord: { kind: 'market' }, Draconis: { kind: 'market' },
  Furbella: { kind: 'market' }, Nutwhisker: { kind: 'market' }, Shadowscale: { kind: 'market' },
  Stardust: { kind: 'market' },
  Fangor: { kind: 'market' }, Lumi: { kind: 'market' }, Raptora: { kind: 'market' },
  Vexalia: { kind: 'market' }, Wrex: { kind: 'market' }, Zephyrix: { kind: 'market' },
  Aerion: { kind: 'market' }, Emberwhisp: { kind: 'market' }, Florien: { kind: 'market' },
  Pyroflare: { kind: 'market' }, Solarix: { kind: 'market' }, Starmane: { kind: 'market' },
  Vulpina: { kind: 'market' },
  Nova: { kind: 'none' }, Nutmeg: { kind: 'none' }, Ollo: { kind: 'none' }, Rattles: { kind: 'none' },
  Ravenwing: { kind: 'none' }, Splash: { kind: 'none' }, Wingsley: { kind: 'none' }, Gromley: { kind: 'none' },
  Drakeling: { kind: 'market' }, Leovar: { kind: 'market' }, Sauronix: { kind: 'market' },
  Scalethorn: { kind: 'market' },
  Lunark: { kind: 'fixed', estimate: MYTHIC_EGG_ESTIMATE },
  Orthrus: { kind: 'fixed', estimate: MYTHIC_EGG_ESTIMATE },
  Thunderhoof: { kind: 'fixed', estimate: MYTHIC_EGG_ESTIMATE },
  Wyrmshadow: { kind: 'fixed', estimate: MYTHIC_EGG_ESTIMATE },
};

export const eggItemName = (species: string) => `${species} Egg`;

/** Item names to seed into market_cache so the price cron keeps them fresh. */
export const HUNTING_MARKET_ITEMS: string[] = [
  ...HUNTING_BOWS.map((b) => b.name),
  ...Object.entries(PET_EGGS).filter(([, p]) => p.kind === 'market').map(([s]) => eggItemName(s)),
];
