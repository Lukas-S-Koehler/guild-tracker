/**
 * Assault Roster goals v2 (docs/assault-roster.md §5). Client-safe, pure.
 *
 * Tier meaning (user):
 *   Bronze  = minimum requirement
 *   Silver  = cost-effective, almost a must-have
 *   Gold    = very good, upper half
 *   Crystal = the top
 *   Dream   = absolutely perfect in that element
 * Prerequisites (gear set, potions set, pets visible) are not goals: without them a member can't be measured.
 * Elements carry an importance that weights "next best moves" (step 5).
 */
import type { RosterRow } from './assault-roster';

export const TIERS = ['Bronze', 'Silver', 'Gold', 'Crystal', 'Dream'] as const;
export type TierName = (typeof TIERS)[number];
export const TIER_MEANING: Record<TierName, string> = {
  Bronze: 'Minimum requirement',
  Silver: 'Cost-effective, almost a must-have',
  Gold: 'Very good, upper half',
  Crystal: 'The top',
  Dream: 'Absolutely perfect',
};

export type Importance = 'core' | 'high' | 'medium' | 'bonus';
export const IMPORTANCE_LABEL: Record<Importance, string> = { core: 'Core', high: 'High', medium: 'Medium', bonus: 'Bonus' };
export const IMPORTANCE_WEIGHT: Record<Importance, number> = { core: 3, high: 2, medium: 1, bonus: 0.5 };

export type TrackId = 'battle' | 'pet_hunt' | 'pet_mastery' | 'battle_pet' | 'hunting_mastery' | 'potions' | 'bow' | 'slayer';

export interface TrackDef {
  id: TrackId;
  label: string;
  importance: Importance;
  hint: string;
  /** Numeric tracks: leaders can edit the 5 thresholds. Fixed tracks describe their ladder. */
  editable: boolean;
  defaults: number[];
  /** Text per tier for the ladder (threshold-aware for editable tracks). */
  tierText: (tier: number, ths: number[], g: GoalSet) => string;
}

const QUALITY_RANK: Record<string, number> = { Standard: 0, Refined: 1, Premium: 2, Event: 2.5, Epic: 3, Legendary: 4, Mythic: 5 };

export const TRACKS: TrackDef[] = [
  {
    id: 'battle',
    label: 'Battle',
    importance: 'core',
    hint: "Hits on every mob at the guild's assault zone with gear from /combat, the default loadout and the best battle pet.",
    editable: false,
    defaults: [],
    tierText: (t, _ths, g) =>
      ['all mobs ≤4 hits', 'all mobs ≤3 hits', 'all mobs 2 hits (unscaled)', `all 2 hits scaled to Lv ${g.battle.crystalScale}+ (CL 100)`, `all 2 hits scaled to Lv ${g.battle.dreamScale} (CL 100)`][t],
  },
  {
    id: 'pet_hunt',
    label: 'Pet hunt power',
    importance: 'core',
    hint: 'Best 20 pets that can hunt at the zone (Citadel est. encounters per hunt). Pets do most of the hunting.',
    editable: true,
    defaults: [600, 1200, 1800, 2500, 4000],
    tierText: (t, ths) => `${ths[t].toLocaleString()} encounters${t === 3 ? ' (≈20 Epic Vulpinas L100)' : t === 4 ? ' (≈20 Legendary L100)' : ''}`,
  },
  {
    id: 'pet_mastery',
    label: 'Pet mastery',
    importance: 'high',
    hint: 'More pets out at once and up to +20% pet stats. 50 = 6 pets, 63 = 7, 75 = 8, 88 = 9, 100 = 10.',
    editable: true,
    defaults: [50, 63, 75, 88, 100],
    tierText: (t, ths) => `mastery ${ths[t]} (${2 + Math.floor(ths[t] / 12.5)} pets)`,
  },
  {
    id: 'battle_pet',
    label: 'Battle pet',
    importance: 'high',
    hint: 'Best battle pet you own. Mostly improves hits, and more defence saves food (gold).',
    editable: false,
    defaults: [],
    tierText: (t) => ['Epic L80+', 'Epic L100', 'Legendary L100', 'Mythic L80+', 'Mythic L100 evo 5'][t],
  },
  {
    id: 'hunting_mastery',
    label: 'Hunting mastery',
    importance: 'high',
    hint: 'The flee mechanic runs on hunting mastery: higher means fewer hunted enemies run away.',
    editable: true,
    defaults: [70, 80, 85, 90, 100],
    tierText: (t, ths) => `level ${ths[t]}`,
  },
  {
    id: 'potions',
    label: 'Potions',
    importance: 'medium',
    hint: 'Default assault loadout rated against the potion presets: Budget = Bronze, Mid = Crystal, Whale = Dream.',
    editable: false,
    defaults: [],
    tierText: (t) => ['Budget preset or better', 'Silver preset or better', 'Gold preset or better', 'Mid preset or better', 'Whale preset'][t],
  },
  {
    id: 'bow',
    label: 'Hunting bow',
    importance: 'medium',
    hint: 'Hunt efficiency of the bow you swap in for hunting. Matters less once your pets hunt well (Gold pet hunt power).',
    editable: true,
    defaults: [5, 10, 15, 18, 20],
    tierText: (t, ths) => `+${ths[t]}% hunt eff${t === 1 ? ' (Nightshade)' : t === 2 ? ' (Grimwood)' : t === 3 ? " (Death's Touch)" : t === 4 ? ' (Sting / Divinity)' : ''}`,
  },
  {
    id: 'slayer',
    label: 'Slayer',
    importance: 'bonus',
    hint: 'Added bonus. Bronze = slayer level at least the highest mob here (eligible for every slayer task here), then slayer % on the mobs here (max 10%).',
    editable: true,
    // [unused, silver avg %, gold avg %, crystal avg %, dream min % on every mob]
    defaults: [0, 2, 4, 7, 10],
    tierText: (t, ths) => (t === 0 ? 'task eligible here' : t === 4 ? `${ths[4]}% on every mob` : `avg ${ths[t]}% on the mobs here`),
  },
];

export interface GoalSet {
  tracks: Record<TrackId, { thresholds: number[] }>;
  battle: { crystalScale: number; dreamScale: number };
}

export function defaultGoals(): GoalSet {
  return {
    tracks: Object.fromEntries(TRACKS.map((t) => [t.id, { thresholds: [...t.defaults] }])) as GoalSet['tracks'],
    battle: { crystalScale: 120, dreamScale: 150 },
  };
}

/** Stored goals merged over defaults. Old 4-tier rows are ignored. */
export function mergeGoals(stored: unknown): GoalSet {
  const g = defaultGoals();
  const src = (stored ?? {}) as { tracks?: Record<string, { thresholds?: unknown[] }>; battle?: { dreamScale?: unknown } };
  for (const t of TRACKS) {
    const ths = src.tracks?.[t.id]?.thresholds;
    if (t.editable && Array.isArray(ths) && ths.length === 5 && ths.every((v) => Number.isFinite(Number(v)))) {
      g.tracks[t.id].thresholds = ths.map(Number);
    }
  }
  const cs = Number((src.battle as { crystalScale?: unknown } | undefined)?.crystalScale);
  const ds = Number(src.battle?.dreamScale);
  if (Number.isFinite(cs) && cs >= 100 && cs <= 150) g.battle.crystalScale = Math.round(cs);
  if (Number.isFinite(ds) && ds >= 100 && ds <= 150) g.battle.dreamScale = Math.round(ds);
  if (g.battle.dreamScale < g.battle.crystalScale) g.battle.dreamScale = g.battle.crystalScale;
  return g;
}

/* ─── prerequisites ─── */

export interface Prereq { id: string; label: string; ok: boolean; fix: string }

export function prerequisites(r: RosterRow): Prereq[] {
  return [
    { id: 'gear', label: 'Gear on /combat', ok: r.battle.gearSet, fix: 'Pick your gear once on /combat' },
    { id: 'potions', label: 'Potion loadout', ok: !!r.battle.loadout, fix: 'Pick a default loadout on /assault/potions' },
    { id: 'pets', label: 'Pets visible', ok: !r.pets_hidden, fix: 'Unhide pets in game settings or add your API key in /setup' },
  ];
}

/* ─── evaluation ─── */

export interface TrackResult {
  id: TrackId;
  /** 0 = below Bronze, 1..5 = Bronze..Dream. */
  tier: number;
  /** null = can't be measured (missing prerequisite). */
  measured: boolean;
  /** Short "where you are" text. */
  current: string;
  /** What the next tier needs (null at Dream). */
  next: string | null;
  /** 0..1 towards the next tier (numeric tracks; fixed ladders use 0 or 0.5). */
  progress: number;
}

function numeric(value: number, ths: number[], fmt: (v: number) => string): Omit<TrackResult, 'id' | 'next'> & { nextIdx: number } {
  let tier = 0;
  for (let i = 0; i < ths.length; i++) if (value >= ths[i]) tier = i + 1;
  const from = tier > 0 ? ths[tier - 1] : 0;
  const to = tier < ths.length ? ths[tier] : null;
  return { tier, measured: true, current: fmt(value), progress: to == null ? 1 : Math.max(0, Math.min(1, (value - from) / (to - from || 1))), nextIdx: tier };
}

/** Battle tier from hits per mob (unscaled) and the 2-hit scaling ceiling (CL 100 only). */
export function battleTier(hits: number[], canPickScale: boolean, max2HitLevel: number | null, g: GoalSet): number {
  if (!hits.length) return 0;
  const worst = Math.max(...hits);
  let tier = 0;
  if (worst <= 4) tier = 1;
  if (worst <= 3) tier = 2;
  if (worst <= 2) tier = 3;
  if (worst <= 2 && canPickScale && (max2HitLevel ?? 0) >= g.battle.crystalScale) tier = 4;
  if (worst <= 2 && canPickScale && (max2HitLevel ?? 0) >= g.battle.dreamScale) tier = 5;
  return tier;
}

export function evaluateTrack(r: RosterRow, def: TrackDef, g: GoalSet): TrackResult {
  const ths = g.tracks[def.id].thresholds;
  const nextText = (tier: number) => (tier >= 5 ? null : def.tierText(tier, ths, g));
  const out = (tier: number, current: string, progress: number, measured = true): TrackResult => ({
    id: def.id, tier, measured, current, next: measured ? nextText(tier) : null, progress,
  });

  switch (def.id) {
    case 'battle': {
      const b = r.battle;
      if (!b.computed) return out(0, 'gear not set', 0, false);
      const hits = b.enemies.map((e) => e.hits ?? 99);
      const tier = battleTier(hits, !b.scaleFixed && b.canScale, b.max2HitLevel, g);
      const twos = hits.filter((h) => h <= 2).length;
      const worst = Math.max(...hits);
      const current = worst <= 2 ? (b.canScale && !b.scaleFixed && b.max2HitLevel ? `all 2 hits, to Lv ${b.max2HitLevel}` : 'all 2 hits') : `${twos}/${hits.length} at 2 hits, worst ${worst}`;
      const progress =
        tier === 3 || tier === 4
          ? Math.max(0, ((b.max2HitLevel ?? 100) - 100) / ((tier === 3 ? g.battle.crystalScale : g.battle.dreamScale) - 100 || 1))
          : twos / Math.max(1, hits.length);
      return out(tier, current, Math.min(1, progress));
    }
    case 'battle_pet': {
      const p = r.battle.bestPet;
      if (!p) return out(0, 'no battle pet', 0);
      const q = QUALITY_RANK[p.tier ?? ''] ?? 0;
      let tier = 0;
      if (q >= 3 && p.level >= 80) tier = 1;
      if (q >= 3 && p.level >= 100) tier = 2;
      if (q >= 4 && p.level >= 100) tier = 3;
      if (q >= 5 && p.level >= 80) tier = 4;
      if (q >= 5 && p.level >= 100 && p.evolution >= 5) tier = 5;
      return out(tier, `${p.species} L${p.level}${p.evolution ? ` evo ${p.evolution}` : ''}`, tier >= 5 ? 1 : Math.min(1, p.level / 100));
    }
    case 'potions': {
      if (!r.battle.loadout) return out(0, 'no loadout', 0, false);
      const t = r.battle.potionTier;
      return out(t, r.battle.preset ? `${r.battle.preset.label} preset` : 'custom loadout', t >= 5 ? 1 : 0);
    }
    case 'slayer': {
      const s = r.slayer;
      if (!s.zoneMaxLevel) return out(0, 'no zone', 0);
      if (s.level < s.zoneMaxLevel) return out(0, `slayer ${s.level}`, Math.min(1, s.level / s.zoneMaxLevel));
      let tier = 1;
      for (let i = 1; i <= 3; i++) if (s.avgPct >= ths[i]) tier = i + 1;
      if (s.minPct >= ths[4]) tier = 5;
      const to = tier < 4 ? ths[tier] : ths[4];
      return out(tier, `avg ${s.avgPct}% · slayer ${s.level}`, tier >= 5 ? 1 : Math.min(1, (tier === 4 ? s.minPct : s.avgPct) / (to || 1)));
    }
    case 'pet_hunt': {
      const n = numeric(r.hunting.squadPower, ths, (v) => `${v.toLocaleString()} encounters`);
      return out(n.tier, n.current, n.progress);
    }
    case 'pet_mastery': {
      const n = numeric(r.pet_mastery ?? 0, ths, (v) => `mastery ${v}`);
      return out(n.tier, n.current, n.progress);
    }
    case 'hunting_mastery': {
      const n = numeric(r.hunting_mastery ?? 0, ths, (v) => `level ${v}`);
      return out(n.tier, n.current, n.progress);
    }
    case 'bow': {
      const v = r.hunting.bow?.huntEff ?? 0;
      const n = numeric(v, ths, (x) => (x ? `+${x}% (${r.hunting.bow?.name})` : 'no bow'));
      return out(n.tier, n.current, n.progress);
    }
  }
}

export function evaluateGoals(r: RosterRow, g: GoalSet): TrackResult[] {
  return TRACKS.map((t) => evaluateTrack(r, t, g));
}

/** Importance weight for next best moves; the bow matters less once pets hunt well (Gold pet hunt power). */
export function trackWeight(id: TrackId, results: TrackResult[]): number {
  const def = TRACKS.find((t) => t.id === id)!;
  let w = IMPORTANCE_WEIGHT[def.importance];
  if (id === 'bow' && (results.find((x) => x.id === 'pet_hunt')?.tier ?? 0) >= 3) w *= 0.5;
  return w;
}

/** Bronze is the minimum: every non-bonus element at Bronze or better (and all prerequisites set). */
export function meetsMinimum(r: RosterRow, results: TrackResult[]): boolean {
  return prerequisites(r).every((p) => p.ok) && results.every((x) => TRACKS.find((t) => t.id === x.id)!.importance === 'bonus' || x.tier >= 1);
}

/**
 * Closest worthwhile next step: a missing Bronze (minimum) on the most important element first,
 * otherwise the best mix of importance and progress.
 */
export function nextStep(results: TrackResult[]): TrackResult | null {
  const open = results.filter((x) => x.measured && x.next != null);
  if (!open.length) return null;
  const missingBronze = open.filter((x) => x.tier === 0 && TRACKS.find((t) => t.id === x.id)!.importance !== 'bonus');
  const pool = missingBronze.length ? missingBronze : open;
  return pool.sort((a, b) => trackWeight(b.id, results) * (0.5 + b.progress) - trackWeight(a.id, results) * (0.5 + a.progress))[0];
}
