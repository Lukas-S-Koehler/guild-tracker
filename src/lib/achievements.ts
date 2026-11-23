/**
 * Achievement catalogue (Dream Hub Phase 2, step 9). Code is the source of truth;
 * unlocks live in `achievement_unlocks` (database/achievements.sql). Spec: docs/achievements.md.
 *
 * Earned per ACCOUNT (main + alts via the full member_alts closure). Sums are pooled across
 * characters, levels use the best character. Evaluated once a day by /api/cron/achievements.
 */

export type Tier = 'bronze' | 'silver' | 'gold' | 'crystal' | 'dream';

export type Category =
  | 'contribution'
  | 'raids'
  | 'reliability'
  | 'streak'
  | 'challenges'
  | 'stockpile'
  | 'assault'
  | 'loyalty'
  | 'level'
  | 'community'
  | 'journey'
  | 'hidden';

/** Metric names produced by src/lib/achievement-eval.ts. Flags are 0/1. */
export type Metric =
  | 'gold'
  | 'raids'
  | 'met_days'
  | 'best_streak'
  | 'challenge_items'
  | 'stockpile_items'
  | 'pool_activations'
  | 'assault_best_season'
  | 'assault_seasons'
  | 'assault_top10'
  | 'assault_top1'
  | 'loyalty_days'
  | 'combat_level'
  | 'total_level'
  | 'bumps'
  | 'discord_linked'
  | 'claimed'
  | 'moved_up'
  | 'top_tier'
  | 'assaulter'
  | 'invader'
  | 'guilds_visited'
  | 'founder'
  | 'top_donor_week'
  | 'network_week_1'
  | 'comeback';

export interface Achievement {
  key: string;
  category: Category;
  name: string;
  description: string;
  tier: Tier;
  metric: Metric;
  threshold: number;
  hidden?: boolean;
}

export const TIERS: Record<Tier, { label: string; xp: number; rank: number; emoji: string }> = {
  bronze: { label: 'Bronze', xp: 10, rank: 1, emoji: '🥉' },
  silver: { label: 'Silver', xp: 25, rank: 2, emoji: '🥈' },
  gold: { label: 'Gold', xp: 50, rank: 3, emoji: '🥇' },
  crystal: { label: 'Crystal', xp: 100, rank: 4, emoji: '💎' },
  dream: { label: 'Dream', xp: 200, rank: 5, emoji: '🌌' },
};

/** Gold and above unlock their name as a selectable title (D5). */
export const grantsTitle = (a: Achievement) => TIERS[a.tier].rank >= TIERS.gold.rank;

export const CATEGORIES: Record<Category, string> = {
  contribution: 'Contribution',
  raids: 'Raids',
  reliability: 'Reliability',
  streak: 'Streak',
  challenges: 'Guild challenges',
  stockpile: 'Stockpile & pools',
  assault: 'Assault',
  loyalty: 'Loyalty',
  level: 'Level',
  community: 'Community',
  journey: 'Journey',
  hidden: 'Hidden',
};

const k = (n: number) => (n >= 1e6 ? `${n / 1e6}M` : n >= 1e3 ? `${n / 1e3}k` : String(n));

function ladder(
  category: Category,
  metric: Metric,
  prefix: string,
  steps: Array<[name: string, threshold: number, tier: Tier]>,
  describe: (t: number) => string
): Achievement[] {
  return steps.map(([name, threshold, tier], i) => ({
    key: `${prefix}-${i + 1}`,
    category,
    name,
    description: describe(threshold),
    tier,
    metric,
    threshold,
  }));
}

export const ACHIEVEMENTS: Achievement[] = [
  ...ladder('contribution', 'gold', 'gold', [
    ['Coin Purse', 100_000, 'bronze'],
    ['Treasury Friend', 500_000, 'silver'],
    ['Vault Keeper', 1_250_000, 'gold'],
    ['Golden Pillar', 3_500_000, 'crystal'],
    ['Dream Benefactor', 7_500_000, 'dream'],
  ], (t) => `Donate and deposit ${k(t)} gold to Dream guilds`),

  ...ladder('raids', 'raids', 'raids', [
    // Pooled over the account's characters, so set higher than one character reaches (~470).
    ['First Raid', 1, 'bronze'],
    ['Raider', 75, 'bronze'],
    ['Raid Regular', 250, 'silver'],
    ['Raid Veteran', 600, 'gold'],
    ['Raid Legend', 1200, 'dream'],
  ], (t) => (t === 1 ? 'Join your first guild raid' : `Join ${t} guild raids`)),

  ...ladder('reliability', 'met_days', 'met', [
    ['Showing Up', 7, 'bronze'],
    ['Dependable', 30, 'bronze'],
    ['Reliable', 90, 'silver'],
    ['Rock Solid', 180, 'gold'],
    ['Unshakeable', 365, 'dream'],
  ], (t) => `Meet your guild requirement on ${t} days`),

  ...ladder('streak', 'best_streak', 'streak', [
    ['On a Roll', 7, 'bronze'],
    ['Two Weeks Strong', 14, 'silver'],
    ['Monthly Machine', 30, 'gold'],
    ['Unbroken', 60, 'crystal'],
    ['Eternal Flame', 100, 'dream'],
  ], (t) => `Meet the requirement ${t} days in a row (holidays don't break it)`),

  ...ladder('challenges', 'challenge_items', 'chal', [
    ['Helping Hand', 10, 'bronze'],
    ['Gatherer', 50, 'bronze'],
    ['Supplier', 150, 'silver'],
    ['Quartermaster', 300, 'gold'],
    ['Challenge Crusher', 500, 'dream'],
  ], (t) => `Contribute ${t} items to guild challenges (each item counts once per challenge)`),

  ...ladder('stockpile', 'stockpile_items', 'stock', [
    ['Stockpiler', 1, 'bronze'],
    ['Hoarder', 25, 'silver'],
    ['Warehouse', 100, 'gold'],
  ], (t) => (t === 1 ? 'Deposit to the guild stockpile' : `Deposit ${t} items to the guild stockpile`)),
  ...ladder('stockpile', 'pool_activations', 'pool', [
    ['Spark', 1, 'bronze'],
    ['Pool Keeper', 10, 'silver'],
    ['Power Plant', 50, 'gold'],
  ], (t) => (t === 1 ? 'Activate an Energizing Pool' : `Activate ${t} Energizing Pools`)),

  ...ladder('assault', 'assault_best_season', 'asl', [
    ['Into the Fray', 1, 'bronze'],
    ['Assault Trooper', 25_000, 'silver'],
    ['Shock Trooper', 100_000, 'gold'],
    ['Siege Breaker', 250_000, 'crystal'],
    ['Conqueror', 400_000, 'dream'],
  ], (t) => (t === 1 ? 'Earn EXP in an assault season' : `Earn ${k(t)} EXP in one assault season`)),
  {
    key: 'asl-seasons-1', category: 'assault', name: 'Campaigner', tier: 'silver',
    metric: 'assault_seasons', threshold: 3, description: 'Fight in 3 assault seasons',
  },
  {
    key: 'asl-seasons-2', category: 'assault', name: 'War Veteran', tier: 'gold',
    metric: 'assault_seasons', threshold: 10, description: 'Fight in 10 assault seasons',
  },
  {
    key: 'asl-top10', category: 'assault', name: 'Spearhead', tier: 'gold',
    metric: 'assault_top10', threshold: 1, description: 'Finish a season in the top 10 of your guild',
  },
  {
    key: 'asl-top1', category: 'assault', name: 'Warlord', tier: 'crystal',
    metric: 'assault_top1', threshold: 1, description: 'Finish a season as #1 of your guild',
  },

  ...ladder('loyalty', 'loyalty_days', 'loyal', [
    ['New Dreamer', 7, 'bronze'],
    ['Settled In', 30, 'bronze'],
    ['Old Hand', 90, 'silver'],
    ['Pillar of Dream', 180, 'gold'],
    ['Dream Elder', 365, 'dream'],
  ], (t) => `Be part of the Dream guilds for ${t} days`),

  ...ladder('level', 'combat_level', 'cl', [
    ['Combat Ready', 40, 'bronze'],
    ['Seasoned Fighter', 60, 'bronze'],
    ['Elite', 80, 'silver'],
    ['Summit', 92, 'gold'],
    ['Max Combat', 100, 'crystal'],
  ], (t) => `Reach combat level ${t}`),
  ...ladder('level', 'total_level', 'tl', [
    ['Well Rounded', 500, 'bronze'],
    ['Jack of All Trades', 1000, 'silver'],
    ['Master of Many', 1500, 'gold'],
    ['Grandmaster', 2000, 'crystal'],
  ], (t) => `Reach total level ${t.toLocaleString('en-US')}`),

  ...ladder('community', 'bumps', 'bump', [
    ['Bumper', 1, 'bronze'],
    ['Hype Crew', 10, 'silver'],
    ['Megaphone', 25, 'gold'],
    ['Town Crier', 50, 'crystal'],
  ], (t) => (t === 1 ? 'Bump the Discord server' : `Bump the Discord server ${t} times`)),
  {
    key: 'linked', category: 'community', name: 'Connected', tier: 'bronze',
    metric: 'discord_linked', threshold: 1, description: 'Link your Discord with /claim',
  },
  {
    key: 'claimed', category: 'community', name: "That's Me", tier: 'bronze',
    metric: 'claimed', threshold: 1, description: 'Claim your account on the website',
  },

  {
    key: 'move-up', category: 'journey', name: 'Climbing', tier: 'silver',
    metric: 'moved_up', threshold: 1, description: 'Move up to a higher CL tier guild',
  },
  {
    key: 'top-tier', category: 'journey', name: 'Summit Guild', tier: 'gold',
    metric: 'top_tier', threshold: 1, description: 'Join a CL 92 raid guild',
  },
  {
    key: 'assaulter', category: 'journey', name: 'Enlisted', tier: 'bronze',
    metric: 'assaulter', threshold: 1, description: 'Join an assault guild (DE or DI)',
  },
  {
    key: 'invader', category: 'journey', name: 'Hardcore', tier: 'gold',
    metric: 'invader', threshold: 1, description: 'Join Dream Invaders',
  },
  {
    key: 'tourist', category: 'journey', name: 'Network Tour', tier: 'silver',
    metric: 'guilds_visited', threshold: 3, description: 'Be a member of 3 different Dream guilds',
  },

  {
    key: 'founder', category: 'hidden', name: 'Founding Dreamer', tier: 'gold', hidden: true,
    metric: 'founder', threshold: 1, description: 'Played in a Dream guild before June 2026',
  },
  {
    key: 'top-donor-week', category: 'hidden', name: 'Carry', tier: 'silver', hidden: true,
    metric: 'top_donor_week', threshold: 1, description: 'Top gold donor of your guild in a week',
  },
  {
    key: 'lb-week-1', category: 'hidden', name: 'Number One', tier: 'crystal', hidden: true,
    metric: 'network_week_1', threshold: 1, description: '#1 on the network activity leaderboard for a week',
  },
  {
    key: 'comeback', category: 'hidden', name: 'Back in Action', tier: 'bronze', hidden: true,
    metric: 'comeback', threshold: 1, description: 'Meet the requirement again after a holiday',
  },
];

export const ACHIEVEMENT_BY_KEY = new Map(ACHIEVEMENTS.map((a) => [a.key, a]));
