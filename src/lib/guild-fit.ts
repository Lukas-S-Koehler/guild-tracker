/**
 * "Which guild is mine" — pure matching on combat level (CL). Client-safe (no DB).
 * Fed by the public guild directory (src/lib/guild-directory.ts).
 *
 * Rules (agreed with staff 2026-11-23):
 * - Raid guilds form a ladder of CL tiers (guild min_level = raid CL). Your guild is the tier
 *   from its CL up to one below the next tier: CL 69 → the CL 60 guild, CL 70 → the CL 70 guild.
 *   Guilds sharing a tier (DT/DR) are equal options.
 * - If that guild is full you go one tier down (and so on). We don't know when a guild is full,
 *   so the tier below is always shown as the fallback.
 * - Dream Engineers (assaults, no raids) is open to every level.
 * - Dream Invaders (hardcore assaults, no raids) takes CL 88+.
 */
import { ASSAULT_ENTRY_GUILD_ID, ASSAULT_TOP_GUILD_ID, ASSAULT_TOP_MIN_CL, type Raid } from '@/lib/raids';

export interface FitGuild {
  id: string;
  name: string;
  tag: string;
  min_level: number;
  is_assault: boolean;
  raids: Raid[];
  requirement: { period: 'daily' | 'weekly'; amount: number };
  member_count: number;
}

export interface FitTier {
  /** Tier CL (the guilds' min_level, which is also the raid CL). */
  cl: number;
  guilds: FitGuild[];
}

export interface FitAnswer {
  /** Your raid tier: highest tier at or below your CL. */
  tier: FitTier | null;
  /** One tier down, for when your tier's guilds are full. */
  fallback: FitTier | null;
  /** Next tier up and how far away it is. */
  next: (FitTier & { levels_needed: number }) | null;
  /** Assault guilds: DE always open, DI from CL 88. */
  de: FitGuild | null;
  di: FitGuild | null;
  di_open: boolean;
  di_levels_needed: number;
}

/** Raid guilds grouped by CL tier, lowest first. */
export function raidTiers(guilds: FitGuild[]): FitTier[] {
  const byCl = new Map<number, FitGuild[]>();
  for (const g of guilds) {
    if (g.is_assault) continue;
    byCl.set(g.min_level, [...(byCl.get(g.min_level) ?? []), g]);
  }
  return Array.from(byCl.entries()).sort((a, b) => a[0] - b[0]).map(([cl, gs]) => ({ cl, guilds: gs }));
}

export function fitGuilds(guilds: FitGuild[], cl: number): FitAnswer {
  const tiers = raidTiers(guilds);
  let idx = -1;
  tiers.forEach((t, i) => { if (cl >= t.cl) idx = i; });
  const tier = idx >= 0 ? tiers[idx] : null;
  const fallback = idx >= 1 ? tiers[idx - 1] : null;
  const up = tiers[idx + 1];
  const de = guilds.find((g) => g.id === ASSAULT_ENTRY_GUILD_ID) ?? null;
  const di = guilds.find((g) => g.id === ASSAULT_TOP_GUILD_ID) ?? null;
  return {
    tier,
    fallback,
    next: up ? { ...up, levels_needed: up.cl - cl } : null,
    de,
    di,
    di_open: cl >= ASSAULT_TOP_MIN_CL,
    di_levels_needed: Math.max(0, ASSAULT_TOP_MIN_CL - cl),
  };
}

/** Gold per day the guild asks for (weekly requirement spread over 7 days). */
export function dailyCost(g: FitGuild): number {
  return g.requirement.period === 'weekly' ? Math.ceil(g.requirement.amount / 7) : g.requirement.amount;
}
