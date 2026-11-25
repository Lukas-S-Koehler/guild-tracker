/**
 * Assault Roster goal tiers (docs/assault-roster.md §5). Client-safe, pure.
 * Tiers: Bronze → Silver → Gold → Crystal. Leaders edit thresholds (and an optional
 * "required" tier = future assault requirement) per guild; defaults are the same for DE and DI.
 */
import type { RosterRow } from './assault-roster';

export const TIERS = ['Bronze', 'Silver', 'Gold', 'Crystal'] as const;
export type TierName = (typeof TIERS)[number];

export type TrackId = 'hits' | 'bow' | 'pet_hunt' | 'pet_mastery' | 'prep';

export interface TrackDef {
  id: TrackId;
  label: string;
  /** How the value reads, e.g. "≤ 3 hits", "15% bow". */
  unit: (v: number) => string;
  /** true = smaller value is better (hits). */
  lowerIsBetter?: boolean;
  /** Default thresholds Bronze..Crystal; null = tier doesn't exist on this track. */
  defaults: (number | null)[];
  hint: string;
}

export const TRACKS: TrackDef[] = [
  {
    id: 'hits',
    label: 'Battle',
    unit: (v) => `all mobs ≤ ${v} hits`,
    lowerIsBetter: true,
    defaults: [5, 4, 3, 2],
    hint: "Hits on every mob at the guild's assault zone (gear from /combat, default loadout, best battle pet).",
  },
  {
    id: 'bow',
    label: 'Hunting bow',
    unit: (v) => `+${v}% hunt eff`,
    defaults: [5, 10, 15, 18],
    hint: 'Hunt efficiency of the hunting bow: 5% any bow, 10% Nightshade, 15% Grimwood, 18%+ Mythic.',
  },
  {
    id: 'pet_hunt',
    label: 'Pet hunt power',
    unit: (v) => `${v.toLocaleString()} encounters`,
    defaults: [600, 1200, 1800, 2500],
    hint: 'Best 20 pets that can hunt at the zone, Citadel est. Crystal ≈ 20 Epic Vulpinas L100.',
  },
  {
    id: 'pet_mastery',
    label: 'Pet mastery',
    unit: (v) => `mastery ${v}`,
    defaults: [25, 50, 75, 100],
    hint: 'More pets out at once: 4 at 25, 6 at 50, 8 at 75, 10 at 100.',
  },
  {
    id: 'prep',
    label: 'Prep',
    unit: (v) => `${v}/3 set`,
    defaults: [1, 2, 3, null],
    hint: 'Gear on /combat, a default potion loadout, a hunting bow.',
  },
];

export interface TrackSetting {
  thresholds: (number | null)[];
  /** 0 = no requirement, 1..4 = required tier (Bronze..Crystal). Future assault requirements. */
  required: number;
}
export type GoalSet = Record<TrackId, TrackSetting>;

export function defaultGoals(): GoalSet {
  return Object.fromEntries(TRACKS.map((t) => [t.id, { thresholds: [...t.defaults], required: 0 }])) as GoalSet;
}

/** Stored goals merged over defaults (unknown/missing tracks fall back). */
export function mergeGoals(stored: unknown): GoalSet {
  const base = defaultGoals();
  const tracks = (stored as { tracks?: Record<string, Partial<TrackSetting>> } | null)?.tracks ?? {};
  for (const t of TRACKS) {
    const s = tracks[t.id];
    if (!s) continue;
    if (Array.isArray(s.thresholds) && s.thresholds.length === 4) {
      base[t.id].thresholds = s.thresholds.map((v) => (v == null || Number.isNaN(Number(v)) ? null : Number(v)));
    }
    if (typeof s.required === 'number') base[t.id].required = Math.max(0, Math.min(4, Math.floor(s.required)));
  }
  return base;
}

/** Value a member has on a track; null = can't be measured yet (e.g. no gear on /combat). */
export function trackValue(r: RosterRow, id: TrackId): number | null {
  switch (id) {
    case 'hits':
      return r.battle.computed ? r.battle.worstHits : null;
    case 'bow':
      return r.hunting.bow?.huntEff ?? 0;
    case 'pet_hunt':
      return r.hunting.squadPower;
    case 'pet_mastery':
      return r.pet_mastery ?? 0;
    case 'prep':
      return Number(r.battle.gearSet) + Number(!!r.battle.loadout) + Number(!!r.hunting.bow);
  }
}

export interface TrackResult {
  id: TrackId;
  value: number | null;
  /** 0 = below Bronze, 1..4 = Bronze..Crystal. */
  tier: number;
  maxTier: number;
  /** Next tier's threshold (null at the top). */
  next: number | null;
  /** 0..1 progress from the current tier's threshold towards the next. */
  progress: number;
  meetsRequired: boolean;
}

export function evaluateTrack(r: RosterRow, def: TrackDef, s: TrackSetting): TrackResult {
  const value = trackValue(r, def.id);
  const ths = s.thresholds;
  const maxTier = ths.filter((t) => t != null).length;
  const reached = (t: number | null) =>
    value != null && t != null && (def.lowerIsBetter ? value <= t : value >= t);
  let tier = 0;
  for (let i = 0; i < ths.length; i++) if (reached(ths[i])) tier = i + 1;
  const next = tier < ths.length ? ths[tier] ?? null : null;
  let progress = 1;
  if (next != null && value != null) {
    const from = tier > 0 ? (ths[tier - 1] as number) : def.lowerIsBetter ? next + 3 : 0;
    const span = def.lowerIsBetter ? from - next : next - from;
    const done = def.lowerIsBetter ? from - value : value - from;
    progress = span > 0 ? Math.max(0, Math.min(1, done / span)) : 0;
  } else if (value == null) progress = 0;
  return { id: def.id, value, tier, maxTier, next, progress, meetsRequired: s.required === 0 || tier >= s.required };
}

export function evaluateGoals(r: RosterRow, goals: GoalSet): TrackResult[] {
  return TRACKS.map((t) => evaluateTrack(r, t, goals[t.id]));
}

export const hasRequirements = (goals: GoalSet) => TRACKS.some((t) => goals[t.id].required > 0);
