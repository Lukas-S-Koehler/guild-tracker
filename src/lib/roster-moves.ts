/**
 * Next best moves (docs/assault-roster.md §6): the cheapest ways for one member to reach their next
 * tier, ranked by element importance. Pure: the roster builder passes prices and catalogs in.
 */
import type { RosterRow } from './assault-roster';
import {
  TRACKS, evaluateGoals, prerequisites, trackWeight, type GoalSet, type TrackId, type TrackResult,
} from './roster-goals';
import { HUNTING_BOWS, PET_EGGS, bowBlocker, eggItemName } from './combat/hunting-gear';
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

/** Egg price: market, fixed estimate (mythic), or null when it can't be bought. */
function eggPrice(species: string, ctx: MoveContext): { price: number; note?: string } | null {
  const e = PET_EGGS[species];
  if (!e || e.kind === 'none') return null;
  if (e.kind === 'fixed') return { price: e.estimate, note: 'est., no market' };
  const p = ctx.price(eggItemName(species));
  return p ? { price: p } : null;
}

function petHuntMoves(r: RosterRow, res: TrackResult, ctx: MoveContext): Move[] {
  const out: Move[] = [];
  const ths = ctx.goals.tracks.pet_hunt.thresholds;
  const target = ths[res.tier];
  if (target == null) return out;
  const pm = r.pet_mastery ?? 0;
  const minLv = r.hunting.minPetLevel;

  const tierOf = (power: number) => ths.filter((t) => power >= t).length;

  // Free: level the pets you own to L100 (pets below the zone level start counting).
  const levelled = r.pets
    .map((p) => petHuntEstimate(p.species, 100, pm, p.evolution)?.citadelEncounters ?? 0)
    .sort((a, b) => b - a)
    .slice(0, HUNT_STABLE_SIZE)
    .reduce((a, b) => a + b, 0);
  const under = r.pets.filter((p) => p.level < 100).length;
  if (under && levelled >= target) {
    out.push({
      track: 'pet_hunt', toTier: tierOf(levelled), kind: 'free',
      title: 'Level your pets to L100',
      detail: `${under} pets under L100${r.pets.some((p) => !p.eligible) ? `, ${r.pets.filter((p) => !p.eligible).length} below L${minLv} don't hunt here yet` : ''} → ≈${levelled.toLocaleString()} encounters`,
      cost: null,
    });
  }

  // Buy: one egg species that fits the tier (each pet ≥ target / 20 at L100), cheapest total.
  if (!ctx.marketAccess) return out;
  // Only buy when your own pets, even levelled to L100, can't get there (levelling is free).
  if (levelled >= target) return out;
  const perPet = target / HUNT_STABLE_SIZE;
  const stable = r.pets
    .map((p) => petHuntEstimate(p.species, 100, pm, p.evolution)?.citadelEncounters ?? 0)
    .sort((a, b) => b - a)
    .slice(0, HUNT_STABLE_SIZE);
  let best: { s: string; n: number; cost: number; power: number; note?: string } | null = null;
  for (const s of Object.keys(PET_EGGS)) {
    const p = eggPrice(s, ctx);
    const enc = petHuntEstimate(s, 100, pm, 0)?.citadelEncounters ?? 0;
    if (!p || enc < perPet) continue;
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
    if (power < target || !n) continue;
    const cost = n * p.price;
    if (!best || cost < best.cost) best = { s, n, cost, power, note: p.note };
  }
  if (best) {
    out.push({
      track: 'pet_hunt', toTier: tierOf(best.power), kind: 'buy',
      title: `Buy ${best.n}× ${best.s} ${best.n > 1 ? 'eggs' : 'egg'}`,
      detail: `on top of your own pets levelled to L100 → ≈${best.power.toLocaleString()} encounters`,
      cost: best.cost,
      costNote: best.note,
    });
  }
  return out;
}

function bowMoves(r: RosterRow, res: TrackResult, ctx: MoveContext): Move[] {
  const need = ctx.goals.tracks.bow.thresholds[res.tier];
  if (need == null || !ctx.marketAccess) return [];
  const options = HUNTING_BOWS.filter((b) => b.huntEff >= need)
    .map((b) => ({ b, price: ctx.price(b.name), blocker: bowBlocker(b, r.combat_level ?? 0, r.dexterity ?? 0) }))
    .filter((o) => o.price);
  const pick = options.filter((o) => !o.blocker).sort((a, b) => a.price! - b.price!)[0] ?? options.sort((a, b) => a.price! - b.price!)[0];
  if (!pick) return [];
  return [{
    track: 'bow', toTier: res.tier + 1, kind: 'buy',
    title: `Buy ${pick.b.name} (+${pick.b.huntEff}%)`,
    detail: pick.blocker ? `${pick.blocker} first` : 'set it on /combat or the roster afterwards',
    cost: pick.price,
  }];
}

function battlePetMoves(r: RosterRow, res: TrackResult, ctx: MoveContext): Move[] {
  // Ladder: [quality, level, evo] per tier.
  const ladder: [number, number, number][] = [[3, 80, 0], [3, 100, 0], [4, 100, 0], [5, 80, 0], [5, 100, 5]];
  const step = ladder[res.tier];
  if (!step) return [];
  const [q, lv, evo] = step;
  // Free: an owned pet of that quality just needs levels / evolutions.
  const owned = r.pets
    .filter((p) => (QUALITY_RANK[p.tier] ?? 0) >= q && PET_STATS[p.species])
    .sort((a, b) => b.level - a.level)[0];
  if (owned) {
    return [{
      track: 'battle_pet', toTier: res.tier + 1, kind: 'train',
      title: `Level ${owned.species} to L${lv}${evo ? ` and evolve to ${evo}` : ''}`,
      detail: `now L${owned.level}${owned.evolution ? ` evo ${owned.evolution}` : ''}`,
      cost: null,
    }];
  }
  if (!ctx.marketAccess) return [];
  // No huge jumps: at most one rarity above the best pet you own (never below Epic).
  const ownedBest = Math.max(0, ...r.pets.filter((p) => PET_STATS[p.species]).map((p) => QUALITY_RANK[p.tier] ?? 0));
  const buyQ = Math.max(3, Math.min(q, Math.floor(ownedBest) + 1));
  const reaches = (quality: number) => ladder.filter(([lq, llv, le]) => quality >= lq && 100 >= llv && le === 0).length;
  if (buyQ >= 5) {
    // Mythics are all equal for this: no species, just "a Mythic egg".
    return [{
      track: 'battle_pet', toTier: reaches(5), kind: 'buy',
      title: 'Buy a Mythic egg',
      detail: 'any Mythic works the same here; level it to L100',
      cost: 20_000_000,
      costNote: 'est., no market',
    }];
  }
  const quality = buyQ === 4 ? 'Legendary' : 'Epic';
  for (const species of r.battle.bestSpecies[quality]) {
    const p = eggPrice(species, ctx);
    if (!p) continue;
    return [{
      track: 'battle_pet', toTier: reaches(buyQ), kind: 'buy',
      title: `Buy ${/^[AEIOU]/.test(species) ? 'an' : 'a'} ${species} egg`,
      detail: `best ${quality} for battling here (hits, then damage taken); level to L100`,
      cost: p.price,
      costNote: p.note,
    }];
  }
  return [];
}

function potionMoves(r: RosterRow, res: TrackResult, ctx: MoveContext): Move[] {
  const next = ctx.presets.filter((p) => p.tier > res.tier).sort((a, b) => a.tier - b.tier)[0];
  if (!next) return [];
  return [{
    track: 'potions', toTier: next.tier, kind: 'buy',
    title: `Run the ${next.label} preset`,
    detail: 'load it on /assault/potions and save as your default',
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
