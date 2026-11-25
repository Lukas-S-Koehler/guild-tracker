/**
 * Next best moves (docs/assault-roster.md §6): the cheapest ways for one member to reach their next
 * tier, ranked by element importance. Pure: the roster builder passes prices and catalogs in.
 */
import type { RosterRow } from './assault-roster';
import {
  TRACKS, evaluateGoals, prerequisites, trackWeight, type GoalSet, type TrackId, type TrackResult,
} from './roster-goals';
import { HUNTING_BOWS, MYTHIC_EGG_ESTIMATE, PET_EGGS, bowBlocker, eggItemName } from './combat/hunting-gear';
import { PET_STATS, petTier } from './combat/pet-data';
import { petHuntEstimate, HUNT_STABLE_SIZE } from './combat/pet-hunting';

export type MoveKind = 'setup' | 'free' | 'train' | 'buy';

export interface Move {
  track: TrackId | 'setup' | 'class';
  /** Tier this move reaches on that element (1..5); 0 for setup. */
  toTier: number;
  kind: MoveKind;
  title: string;
  detail?: string;
  /** Gold, null = no gold (setup / free / training). */
  cost: number | null;
  /** e.g. "per assault" for potions, "est., no market" for mythic eggs. */
  costNote?: string;
  href?: string;
  /** Opens the "weigh options" view (all eggs / species per target tier, including jumps). */
  weigh?: 'pet_hunt' | 'battle_pet' | 'bow';
}

export interface MoveContext {
  goals: GoalSet;
  /** Market price by item name (0 / missing = unknown). */
  price: (name: string) => number | null;
  /** Per-assault cost of each tiered potion preset. */
  presets: { id: string; label: string; tier: number; cost: number | null }[];
  marketAccess: boolean;
}

const fmtGold = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
export { fmtGold };

const QUALITY_RANK: Record<string, number> = { Standard: 0, Refined: 1, Premium: 2, Event: 2.5, Epic: 3, Legendary: 4, Mythic: 5 };
/** Egg rarities in buying order (cheapest first). */
export const EGG_RARITIES = ['Standard', 'Refined', 'Premium', 'Epic', 'Legendary', 'Mythic'] as const;

/* ─── pet hunt planning (shared by the moves and the "weigh options" view) ─── */

/** A buyable egg for pet hunting. Mythic eggs hatch a random Mythic, so they are one generic row (worst case). */
export interface EggOption {
  key: string;
  label: string;
  species: string | null;
  quality: string;
  /** Citadel est. encounters per hunt at L100 with this member's pet mastery. */
  enc: number;
  price: number | null;
  note?: string;
}

export interface HuntPlan extends EggOption {
  /** Eggs needed to reach the target (null = this egg can't reach it). */
  n: number | null;
  cost: number | null;
  /** Pet hunt power after buying n eggs (or the most this egg can reach). */
  power: number;
  reached: boolean;
  /** Pulls its weight at this target: ≥ target / 20 encounters per pet (a full stable of it gets there). */
  fits: boolean;
  /** Gold per encounter one egg adds to a hunt. */
  perEnc: number | null;
}

/** Encounters of the best 20 own pets if all were levelled to L100. */
export function stableAtL100(r: RosterRow): number[] {
  const pm = r.pet_mastery ?? 0;
  return r.pets
    .map((p) => petHuntEstimate(p.species, 100, pm, p.evolution)?.citadelEncounters ?? 0)
    .sort((a, b) => b - a)
    .slice(0, HUNT_STABLE_SIZE);
}

/** Buyable eggs with their L100 encounters for this pet mastery and market price. */
export function huntEggOptions(petMastery: number, ctx: Pick<MoveContext, 'price'>): EggOption[] {
  const out: EggOption[] = [];
  let worstMythic: number | null = null;
  for (const [species, pricing] of Object.entries(PET_EGGS)) {
    if (pricing.kind === 'none') continue;
    const enc = petHuntEstimate(species, 100, petMastery, 0)?.citadelEncounters ?? 0;
    if (!enc) continue;
    if (pricing.kind === 'fixed') {
      worstMythic = worstMythic == null ? enc : Math.min(worstMythic, enc);
      continue;
    }
    const quality = petTier(species) ?? PET_STATS[species]?.quality ?? 'Standard';
    out.push({ key: species, label: species, species, quality, enc, price: ctx.price(eggItemName(species)) || null });
  }
  if (worstMythic != null) {
    out.push({ key: 'mythic', label: 'Mythic egg (random species)', species: null, quality: 'Mythic', enc: worstMythic, price: MYTHIC_EGG_ESTIMATE, note: 'est., no market' });
  }
  return out;
}

/** Add n eggs of one kind (replacing the weakest of the counted 20) until the target is reached. */
function fillStable(stable: number[], enc: number, target: number): { n: number; power: number; reached: boolean } {
  const st = [...stable];
  let power = st.reduce((a, b) => a + b, 0);
  let n = 0;
  while (power < target && n < HUNT_STABLE_SIZE) {
    const weakest = st.length < HUNT_STABLE_SIZE ? 0 : st[st.length - 1];
    if (enc <= weakest) break;
    if (st.length >= HUNT_STABLE_SIZE) st.pop();
    st.push(enc);
    st.sort((a, b) => b - a);
    power += enc - weakest;
    n++;
  }
  return { n, power, reached: power >= target };
}

/** Every egg option planned against one pet hunt power target. */
export function huntPlans(stable: number[], options: EggOption[], target: number): HuntPlan[] {
  return options
    .map((o) => {
      const f = fillStable(stable, o.enc, target);
      const reached = f.reached && f.n > 0;
      return {
        ...o,
        n: reached ? f.n : null,
        cost: reached && o.price ? f.n * o.price : null,
        power: f.power,
        reached,
        fits: o.enc >= target / HUNT_STABLE_SIZE,
        perEnc: o.price ? Math.round(o.price / o.enc) : null,
      };
    })
    .sort((a, b) => EGG_RARITIES.indexOf(a.quality as never) - EGG_RARITIES.indexOf(b.quality as never) || b.enc - a.enc);
}

/**
 * The egg to suggest for a target (user rule): the lowest rarity whose pets fit the tier
 * (≥ target / 20 each, so they stay useful) and reach it, and within that rarity the STRONGEST
 * species: pets hunt for months, a little gold doesn't outweigh that.
 */
export function recommendHunt(plans: HuntPlan[]): HuntPlan | null {
  for (const q of EGG_RARITIES) {
    const pick = plans.filter((p) => p.quality === q && p.reached && p.fits && p.price).sort((a, b) => b.enc - a.enc || a.price! - b.price!)[0];
    if (pick) return pick;
  }
  return null;
}

function petHuntMoves(r: RosterRow, res: TrackResult, ctx: MoveContext): Move[] {
  const out: Move[] = [];
  const ths = ctx.goals.tracks.pet_hunt.thresholds;
  const target = ths[res.tier];
  if (target == null) return out;
  const minLv = r.hunting.minPetLevel;
  const tierOf = (power: number) => ths.filter((t) => power >= t).length;

  // Free: level the pets you own to L100 (pets below the zone level start counting).
  const stable = r.hunting.stableL100.length ? r.hunting.stableL100 : stableAtL100(r);
  const levelled = stable.reduce((a, b) => a + b, 0);
  const under = r.pets.filter((p) => p.level < 100).length;
  if (under && levelled >= target) {
    out.push({
      track: 'pet_hunt', toTier: tierOf(levelled), kind: 'free',
      title: 'Level your pets to L100',
      detail: `${under} pets under L100${r.pets.some((p) => !p.eligible) ? `, ${r.pets.filter((p) => !p.eligible).length} below L${minLv} don't hunt here yet` : ''} → ≈${levelled.toLocaleString()} encounters`,
      cost: null,
      weigh: 'pet_hunt',
    });
  }

  // Buy only when your own pets, even levelled to L100, can't get there (levelling is free).
  if (!ctx.marketAccess || levelled >= target) return out;
  const best = recommendHunt(huntPlans(stable, r.hunting.eggOptions, target));
  if (best) {
    out.push({
      track: 'pet_hunt', toTier: tierOf(best.power), kind: 'buy',
      title: best.species ? `Buy ${best.n}× ${best.species} ${best.n! > 1 ? 'eggs' : 'egg'}` : `Buy ${best.n}× Mythic ${best.n! > 1 ? 'eggs' : 'egg'}`,
      detail: `strongest ${best.quality} for hunting, on top of your own pets levelled to L100 → ≈${best.power.toLocaleString()} encounters`,
      cost: best.cost,
      costNote: best.note,
      weigh: 'pet_hunt',
    });
  }
  return out;
}

/* ─── hunting bow planning ─── */

export interface BowOption {
  name: string;
  quality: string;
  huntEff: number;
  combatLevel: number;
  dexterity: number;
  price: number | null;
  /** Missing requirement for this character (e.g. "needs CL 90"), null = can equip now. */
  blocker: string | null;
}

export function bowOptions(r: RosterRow, ctx: Pick<MoveContext, 'price'>): BowOption[] {
  return HUNTING_BOWS.map((b) => ({ ...b, price: ctx.price(b.name) || null, blocker: bowBlocker(b, r.combat_level ?? 0, r.dexterity ?? 0) }));
}

/**
 * Bow to suggest for a hunt efficiency target (same rule as eggs): the lowest rarity that reaches it,
 * and within that rarity the STRONGEST bow you can equip now (ties: cheaper). If none is equippable
 * yet, the closest-to-equippable one that reaches it, with the requirement shown.
 */
export function recommendBow(options: BowOption[], need: number): BowOption | null {
  const reach = options.filter((o) => o.huntEff >= need && o.price);
  for (const q of ['Legendary', 'Mythic']) {
    const pick = reach.filter((o) => o.quality === q && !o.blocker).sort((a, b) => b.huntEff - a.huntEff || a.price! - b.price!)[0];
    if (pick) return pick;
  }
  const blocked = reach.sort((a, b) => a.combatLevel - b.combatLevel || a.price! - b.price!)[0];
  if (blocked) return blocked;
  // No recent sales for any bow that gets there (e.g. Sting / Divinity): still name the strongest you can equip.
  return options.filter((o) => o.huntEff >= need).sort((a, b) => Number(!!a.blocker) - Number(!!b.blocker) || b.huntEff - a.huntEff)[0] ?? null;
}

function bowMoves(r: RosterRow, res: TrackResult, ctx: MoveContext): Move[] {
  const ths = ctx.goals.tracks.bow.thresholds;
  const need = ths[res.tier];
  if (need == null || !ctx.marketAccess) return [];
  const pick = recommendBow(r.hunting.bowOptions.length ? r.hunting.bowOptions : bowOptions(r, ctx), need);
  if (!pick) return [];
  // Equip first (many already own a bow), buying is the fallback (user rule).
  return [{
    track: 'bow', toTier: ths.filter((t) => pick.huntEff >= t).length, kind: 'buy',
    title: `${r.hunting.bow ? 'Equip a stronger hunting bow' : 'Equip a hunting bow'} (+${need}% hunt eff or more)`,
    detail: `Have one? Pick it in the bow picker. Don't have one? Buy ${pick.name} (+${pick.huntEff}%)${pick.blocker ? `, ${pick.blocker} first` : `, the strongest ${pick.quality} bow you can equip`}.`,
    cost: pick.price,
    costNote: pick.price ? 'if you buy one' : 'no recent sales',
    weigh: 'bow',
  }];
}

/* ─── battle pet planning ─── */

/** Battle pet tiers: [quality rank, level, evolution] for Bronze..Dream (matches the battle_pet goal). */
export const BATTLE_PET_LADDER: [number, number, number][] = [[3, 80, 0], [3, 100, 0], [4, 100, 0], [5, 80, 0], [5, 100, 5]];
export const QUALITY_BY_RANK: Record<number, string> = { 3: 'Epic', 4: 'Legendary', 5: 'Mythic' };

/** A species simulated as this member's battle pet at L100 at the location. */
export interface BattleSpeciesOption {
  /** null = generic Mythic egg (random species, worst case shown). */
  species: string | null;
  label: string;
  quality: string;
  /** Total hits over every mob here at its own level (fewer = better), and the worst single mob. */
  hits: number;
  worst: number;
  /** Per-mob breakdown, e.g. "4×2" = four mobs die in 2 hits. */
  dist: string;
  /** Hits per mob here, fewest first (one square each in the UI, like the Lineup). */
  perMob: (number | null)[];
  /** CL 100+: highest scaled level where every mob still dies in 2 hits (null = can't pick a scale). */
  twoHitLv: number | null;
  /** Damage taken per kill, summed over the mobs (defence saves food). */
  taken: number;
  dmg: number;
  price: number | null;
  note?: string;
}

export function priceBattleOptions(options: BattleSpeciesOption[], ctx: Pick<MoveContext, 'price'>) {
  for (const o of options) {
    if (!o.species) { o.price = MYTHIC_EGG_ESTIMATE; o.note = 'est., no market'; continue; }
    const egg = PET_EGGS[o.species];
    if (egg?.kind === 'fixed') { o.price = egg.estimate; o.note = 'est., no market'; }
    else o.price = ctx.price(eggItemName(o.species)) || null;
  }
}

/**
 * Owned pet that only needs levels / evolutions to reach a battle pet tier step. Prefers the pet
 * shown as "best battle pet" here, then the species that battles best here at L100, then level.
 */
export function ownedForBattleStep(r: RosterRow, step: [number, number, number]) {
  const best = r.battle.bestPet;
  const rank = (species: string) => {
    const i = r.battle.speciesOptions.findIndex((o) => o.species === species);
    return i < 0 ? 999 : i;
  };
  return r.pets
    .filter((p) => (QUALITY_RANK[p.tier] ?? 0) >= step[0] && PET_STATS[p.species])
    .sort((a, b) => {
      const isBest = (p: typeof a) => (best && p.species === best.species && p.level === best.level ? 1 : 0);
      return isBest(b) - isBest(a) || (QUALITY_RANK[b.tier] ?? 0) - (QUALITY_RANK[a.tier] ?? 0) || rank(a.species) - rank(b.species) || b.level - a.level;
    })[0] ?? null;
}

/** Strongest species of a quality for battling here that can be bought (has a price). */
export function recommendBattle(r: RosterRow, quality: string): BattleSpeciesOption | null {
  return r.battle.speciesOptions.find((o) => o.quality === quality && o.price) ?? null;
}

function battlePetMoves(r: RosterRow, res: TrackResult, ctx: MoveContext): Move[] {
  const step = BATTLE_PET_LADDER[res.tier];
  if (!step) return [];
  const [q, lv, evo] = step;
  // Free: an owned pet of that quality just needs levels / evolutions.
  const owned = ownedForBattleStep(r, step);
  if (owned) {
    return [{
      track: 'battle_pet', toTier: res.tier + 1, kind: 'train',
      title: `Level ${owned.species} to L${lv}${evo ? ` and evolve to ${evo}` : ''}`,
      detail: `now L${owned.level}${owned.evolution ? ` evo ${owned.evolution}` : ''}`,
      cost: null,
      weigh: 'battle_pet',
    }];
  }
  if (!ctx.marketAccess) return [];
  // No huge jumps in the main suggestion: at most one rarity above the best pet you own (never below Epic).
  // Bigger jumps are in the weigh-options view.
  const ownedBest = Math.max(0, ...r.pets.filter((p) => PET_STATS[p.species]).map((p) => QUALITY_RANK[p.tier] ?? 0));
  const buyQ = Math.max(3, Math.min(q, Math.floor(ownedBest) + 1));
  const reaches = (quality: number) => BATTLE_PET_LADDER.filter(([lq, llv, le]) => quality >= lq && 100 >= llv && le === 0).length;
  const pick = recommendBattle(r, QUALITY_BY_RANK[buyQ]);
  if (!pick) return [];
  return [{
    track: 'battle_pet', toTier: reaches(buyQ), kind: 'buy',
    title: pick.species ? `Buy ${/^[AEIOU]/.test(pick.species) ? 'an' : 'a'} ${pick.species} egg` : 'Buy a Mythic egg',
    detail: pick.species
      ? `strongest ${pick.quality} for battling here (hits, then 2-hit scaling, then damage); level to L100`
      : 'any Mythic works about the same here; level it to L100',
    cost: pick.price,
    costNote: pick.note,
    weigh: 'battle_pet',
  }];
}

function potionMoves(r: RosterRow, res: TrackResult, ctx: MoveContext): Move[] {
  const next = ctx.presets.filter((p) => p.tier > res.tier).sort((a, b) => a.tier - b.tier)[0];
  if (!next) return [];
  return [{
    track: 'potions', toTier: next.tier, kind: 'buy',
    title: r.battle.loadoutSource === 'own' ? `Run the ${next.label} preset` : `Save your own loadout (${next.label} preset or better)`,
    detail: r.battle.loadoutSource === 'own'
      ? 'load it on /assault/potions and save as your default'
      : 'no potion tier until you save one on /assault/potions; hits use the Mid preset meanwhile',
    cost: next.cost,
    costNote: 'per assault',
    href: '/assault/potions',
  }];
}

function trainMove(track: TrackId, res: TrackResult, current: number, target: number, what: string): Move {
  return { track, toTier: res.tier + 1, kind: 'train', title: `Train ${what} to ${target}`, detail: `${target - current} levels to go`, cost: null };
}

/** All candidate moves for one member, best first. */
export function computeMoves(r: RosterRow, ctx: MoveContext): Move[] {
  const missing = prerequisites(r).filter((p) => !p.ok);
  const setup: Move[] = missing.map((p) => ({
    track: 'setup', toTier: 0, kind: 'setup', title: p.label, detail: p.fix, cost: null,
    href: p.id === 'gear' ? '/combat' : p.id === 'potions' ? '/assault/potions' : '/setup',
  }));

  const results = evaluateGoals(r, ctx.goals);
  const moves: (Move & { score: number })[] = [];
  for (const res of results) {
    if (!res.measured || res.next == null) continue;
    const def = TRACKS.find((t) => t.id === res.id)!;
    const ths = ctx.goals.tracks[res.id].thresholds;
    let list: Move[] = [];
    switch (res.id) {
      case 'battle':
        list = r.battle.upgrade
          ? [{
              track: 'battle', toTier: r.battle.upgrade.toTier, kind: 'buy',
              title: `Buy ${r.battle.upgrade.item}`,
              detail: `${r.battle.upgrade.slot} slot, tier 1 → ${res.next}`,
              cost: r.battle.upgrade.price,
            }]
          : res.tier >= 3 && (r.combat_level ?? 0) < 100
            ? [{ track: 'battle', toTier: res.tier + 1, kind: 'train', title: 'Reach CL 100 to pick your scaling level', cost: null }]
            : [];
        break;
      case 'pet_hunt': list = petHuntMoves(r, res, ctx); break;
      case 'bow': list = bowMoves(r, res, ctx); break;
      case 'battle_pet': list = battlePetMoves(r, res, ctx); break;
      case 'potions': list = potionMoves(r, res, ctx); break;
      case 'pet_mastery': list = [trainMove('pet_mastery', res, r.pet_mastery ?? 0, ths[res.tier], 'pet mastery')]; break;
      case 'hunting_mastery': list = [trainMove('hunting_mastery', res, r.hunting_mastery ?? 0, ths[res.tier], 'hunting mastery')]; break;
      case 'slayer':
        list = res.tier === 0
          ? [trainMove('slayer', res, r.slayer.level, r.slayer.zoneMaxLevel, 'slayer')]
          : [{ track: 'slayer', toTier: res.tier + 1, kind: 'train', title: 'Do slayer tasks on the mobs here', detail: res.next ?? undefined, cost: null }];
        break;
    }
    const w = trackWeight(res.id, results);
    const minimumGap = res.tier === 0 && def.importance !== 'bonus';
    for (const m of list) {
      // Missing minimum first; then weight, cheaper first (gold on a log scale), free/training slightly ahead.
      const costFactor = m.cost == null ? 1 : 1 / (1 + Math.log10(1 + m.cost / 10_000));
      moves.push({ ...m, score: (minimumGap ? 100 : 0) + w * costFactor * (0.6 + 0.4 * res.progress) });
    }
  }
  moves.sort((a, b) => b.score - a.score);
  const ranked = moves.map(({ score: _s, ...m }) => m);
  // Ranger is the best assault class: always suggest it (right after the top goal move).
  if ((r.character_class ?? '').toUpperCase() !== 'RANGER') {
    ranked.splice(Math.min(1, ranked.length), 0, {
      track: 'class', toTier: 0, kind: 'free',
      title: 'Switch class to Ranger',
      detail: 'Best class for assaults: Eagle Eye +5% crit chance, Nature\'s Aid +15 crit damage',
      cost: null,
    });
  }
  return [...setup, ...ranked];
}
