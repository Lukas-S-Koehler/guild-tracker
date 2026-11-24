/**
 * Dream Pass (Dream Hub step 15, D6). Spec + calibration: docs/dream-pass.md.
 *
 *  - Season = calendar month (UTC), key 'YYYY-MM'. Season XP + pass level reset on the 1st.
 *  - Lifetime Dream XP = every season's XP added up; drives the rank roles (src/lib/achievement-ranks.ts).
 *  - Earned per account (main + alts pooled). XP is recomputed daily from source data by
 *    src/lib/dream-pass-eval.ts and stored in `dream_pass_scores`.
 *
 * Pure values and curves only (safe to import from client components).
 */

export const PASS_XP = {
  /** Per game day the account met its requirement (any character, once per day). */
  met: 10,
  /** Every 7th met day in a row (holidays pause the streak). */
  streak7: 20,
  raid: 2,
  bump: 1,
  /** Per day with at least CHAT_DAY_MIN counted Discord messages. */
  chatDay: 5,
  kudosReceived: 15,
  kudosGiven: 5,
  /** Assault wave the account fought in (≥ waveMinExp EXP in that wave). */
  wave: 40,
  waveExpPer: 2000,
  waveExpCap: 25,
  waveMinExp: 1000,
  /** Assault season finish, per zone, rank by EXP inside your guild. */
  top10: 75,
  top1: 150,
  /** Guild finished top 10 in the zone and you attended ≥ half its waves. */
  territory: 100,
} as const;

/** Contribution value per game day (challenge items + stockpile deposits at market price) → XP. Highest band first. */
export const CONTRIBUTION_BANDS: Array<[minGold: number, xp: number]> = [
  [150_000, 10],
  [75_000, 8],
  [30_000, 6],
  [15_000, 4],
  [5_000, 2],
];

export const contributionXp = (gold: number) => CONTRIBUTION_BANDS.find(([min]) => gold >= min)?.[1] ?? 0;

export type PassSource =
  | 'daily'
  | 'streak'
  | 'raids'
  | 'contribution'
  | 'assault'
  | 'assault_finish'
  | 'kudos'
  | 'bumps'
  | 'chat'
  | 'achievements';

export const PASS_SOURCES: Record<PassSource, { label: string; emoji: string; hint: string }> = {
  assault: { label: 'Assault waves', emoji: '⚔️', hint: `${PASS_XP.wave} per wave + 1 per ${PASS_XP.waveExpPer / 1000}k EXP (max +${PASS_XP.waveExpCap})` },
  assault_finish: { label: 'Assault season', emoji: '🏰', hint: `top 10 of your guild +${PASS_XP.top10}, #1 +${PASS_XP.top1}, territory +${PASS_XP.territory}` },
  daily: { label: 'Requirement met', emoji: '✅', hint: `${PASS_XP.met} per day` },
  streak: { label: 'Streak bonus', emoji: '🔥', hint: `+${PASS_XP.streak7} every 7 days in a row` },
  raids: { label: 'Raids', emoji: '🐉', hint: `${PASS_XP.raid} per raid` },
  contribution: { label: 'Contribution', emoji: '💰', hint: 'challenge items + stockpile by value: 5k → 2 … 150k → 10 per day' },
  kudos: { label: 'Kudos', emoji: '💎', hint: `${PASS_XP.kudosReceived} received, ${PASS_XP.kudosGiven} given` },
  bumps: { label: 'Bumps', emoji: '📣', hint: `${PASS_XP.bump} per bump` },
  chat: { label: 'Discord chat', emoji: '💬', hint: `${PASS_XP.chatDay} per day with 3+ messages` },
  achievements: { label: 'Achievements', emoji: '🏆', hint: 'Bronze 10 · Silver 25 · Gold 50 · Crystal 100 · Dream 200' },
};

export const SOURCE_ORDER: PassSource[] = ['assault', 'assault_finish', 'daily', 'streak', 'raids', 'contribution', 'kudos', 'bumps', 'chat', 'achievements'];

export type Breakdown = Partial<Record<PassSource, number>>;

// ─── Seasons ─────────────────────────────────────────────────────────────────

export const LIFETIME = 'lifetime';
/** Days after the month ends before a season is frozen and announced. */
export const FINALIZE_GRACE_DAYS = 2;

export const seasonOf = (date: string) => date.slice(0, 7);
export const currentSeason = (now = new Date()) => now.toISOString().slice(0, 7);
export function previousSeason(season: string): string {
  const [y, m] = season.split('-').map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}
/** First day after the season (YYYY-MM-DD). */
export function seasonEnd(season: string): string {
  const [y, m] = season.split('-').map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}
export const seasonLabel = (season: string) =>
  new Date(`${season}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

// ─── Pass levels (per season) ────────────────────────────────────────────────

export const MAX_LEVEL = 20;
/** XP past MAX_LEVEL per ⭐. */
export const STAR_XP = 100;
/** Cost of reaching level L from L−1. */
export const levelCost = (level: number) => 30 + 3 * (level - 1);
/** Total XP needed for level L. */
export const xpForLevel = (level: number) => 30 * level + 1.5 * level * (level - 1);
/** Levels where a #hall-of-fame milestone is posted. */
export const MILESTONE_LEVELS = [5, 10, 15, 20];

export interface PassLevel {
  level: number;
  /** ⭐ past MAX_LEVEL. */
  stars: number;
  /** XP into the current level (or star). */
  into: number;
  /** XP the current level (or star) costs. */
  need: number;
}

export function passLevel(xp: number): PassLevel {
  const capXp = xpForLevel(MAX_LEVEL);
  if (xp >= capXp) {
    const over = xp - capXp;
    return { level: MAX_LEVEL, stars: Math.floor(over / STAR_XP), into: over % STAR_XP, need: STAR_XP };
  }
  let level = 0;
  while (level < MAX_LEVEL && xp >= xpForLevel(level + 1)) level++;
  return { level, stars: 0, into: xp - xpForLevel(level), need: levelCost(level + 1) };
}

// ─── Discord levels (lifetime, parallel system) ──────────────────────────────

/** A message counts when it has ≥ this many characters (or an attachment). */
export const CHAT_MIN_CHARS = 5;
/** Seconds between two counted messages of the same person (any channel). */
export const CHAT_COOLDOWN_S = 60;
/** Counted messages in a day for a pass "chat day". */
export const CHAT_DAY_MIN = 3;

/** Total Discord XP for Discord level L (1 XP per counted message, +1 per bump). */
export const discordXpForLevel = (level: number) => 3 * level * level + 7 * level;

export function discordLevel(xp: number): { level: number; into: number; need: number } {
  let level = 0;
  while (xp >= discordXpForLevel(level + 1)) level++;
  return { level, into: xp - discordXpForLevel(level), need: discordXpForLevel(level + 1) - discordXpForLevel(level) };
}

/**
 * Apply the cooldown to one person's message times (ms, any order). Returns the counted times, ascending.
 */
export function countedMessages(times: number[]): number[] {
  const sorted = times.slice().sort((a, b) => a - b);
  const out: number[] = [];
  let last = -Infinity;
  for (const t of sorted) {
    if (t - last < CHAT_COOLDOWN_S * 1000) continue;
    out.push(t);
    last = t;
  }
  return out;
}
