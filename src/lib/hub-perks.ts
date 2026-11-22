/**
 * What being in the Dream Guilds gets you, across the game, Discord and this site.
 * Single source for the landing page and the Discord advertising posts (Admin → Discord →
 * Advertising), so a new feature only needs a line here to show up everywhere.
 * Keep each line short and factual: only list things that exist today.
 */
export type PerkArea = 'game' | 'discord' | 'site';

export interface PerkGroup {
  area: PerkArea;
  title: string;
  /** Discord emoji used in the advertising posts. */
  emoji: string;
  perks: string[];
}

export const PERK_GROUPS: PerkGroup[] = [
  {
    area: 'game',
    title: 'In game',
    emoji: '⚔️',
    perks: [
      'A raid guild for every CL, 2–3 raids a day',
      'Move up a guild as your CL grows, without leaving the family',
      'Energizing Pools in Dream Engineers: up to 12% Magic Find and 15% EXP',
      'Assault guilds for conquests, territory boosts and shard rewards',
      'Overflow bank: extra gold covers the days you can’t donate',
    ],
  },
  {
    area: 'discord',
    title: 'On Discord',
    emoji: '💬',
    perks: [
      'DreamBot raid and assault pings, so you never miss a launch',
      'Daily activity check with a heads-up before anyone gets kicked',
      'League party finder, market and forging services',
      'Giveaways, bump leaderboard and an active, helpful community',
    ],
  },
  {
    area: 'site',
    title: 'On the website',
    emoji: '🌐',
    perks: [
      'Your own dashboard: daily check, streaks and guild journey across all your characters',
      'Combat tool and assault planner (checklist, potions, locations)',
      'Leaderboards and live stats for every guild',
      'Find the right guild for your CL in seconds',
    ],
  },
];
