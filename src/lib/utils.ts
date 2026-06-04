import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatGold(amount: number): string {
  if (amount >= 1000000) {
    return `${(amount / 1000000).toFixed(1)}M`;
  }
  if (amount >= 1000) {
    return `${(amount / 1000).toFixed(1)}K`;
  }
  return amount.toLocaleString();
}

export function formatDate(date: string | Date): string {
  const d = new Date(date);
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function getToday(): string {
  return new Date().toISOString().split('T')[0];
}

export const CRON_HOUR_UTC = 11;
export const CRON_MINUTE_UTC = 50;

// Returns yesterday if before cron time (11:50 UTC), else today.
export function getLastCompletedDay(): string {
  const now = new Date();
  const beforeCron =
    now.getUTCHours() < CRON_HOUR_UTC ||
    (now.getUTCHours() === CRON_HOUR_UTC && now.getUTCMinutes() < CRON_MINUTE_UTC);
  if (beforeCron) {
    const y = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
    return y.toISOString().split('T')[0];
  }
  return now.toISOString().split('T')[0];
}

// Milliseconds until next cron run (11:50 UTC).
export function msUntilNextCron(): number {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), CRON_HOUR_UTC, CRON_MINUTE_UTC));
  if (now >= next) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - now.getTime();
}

export function getWeekStart(): string {
  const now = new Date();
  const day = now.getUTCDay();
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day + (day === 0 ? -6 : 1)));
  return monday.toISOString().split('T')[0];
}

export function getMonthStart(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().split('T')[0];
}

export function calculateActivityScore(raids: number, goldDonated: number): number {
  return (raids * 1000) + goldDonated;
}

export function getRankEmoji(rank: number): string {
  switch (rank) {
    case 1: return '🥇';
    case 2: return '🥈';
    case 3: return '🥉';
    default: return `#${rank}`;
  }
}

export function getInactivityCategory(daysInactive: number): string {
  if (daysInactive === 0) return 'active';
  if (daysInactive === 1) return '1d';
  if (daysInactive === 2) return '2d';
  if (daysInactive === 3) return '3d';
  return '4d+'; // 4+ days = kick
}

export function getInactivityEmoji(category: string): string {
  // New warning tiers: 1d=green, 2d=yellow, 3d=orange, 4d+=red
  switch (category) {
    case '4d+':
      return '🔴'; // Red - kick
    case '3d':
      return '🟠'; // Orange - private + optional public
    case '2d':
      return '🟡'; // Yellow - private warn
    case '1d':
      return '🟢'; // Green - safe
    default:
      return '🟢';
  }
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// Discord formatting
export function formatInactivityReport(
  members: Array<{ ign: string; category: string }>,
  guildName: string
): string {
  const grouped: Record<string, string[]> = {};

  members.forEach(m => {
    if (!grouped[m.category]) grouped[m.category] = [];
    grouped[m.category].push(m.ign);
  });

  let output = `**${guildName} - Inactivity Report**\n`;
  output += `*Generated: ${new Date().toLocaleDateString()}*\n\n`;

  // New warning tiers: 1d=green(safe), 2d=yellow(private), 3d=orange(private+public), 4d+=red(kick)
  const categories = ['1d', '2d', '3d', '4d+'];

  for (const cat of categories) {
    if (grouped[cat] && grouped[cat].length > 0) {
      const emoji = getInactivityEmoji(cat);
      output += `${emoji} **${cat} Inactive**: ${grouped[cat].join(', ')}\n`;
    }
  }

  return output;
}

export function formatLeaderboard(
  entries: Array<{ ign: string; total_raids: number; total_gold: number; activity_score: number }>,
  period: string
): string {
  let output = `**🏆 Activity Leaderboard - ${period}**\n\n`;

  entries.slice(0, 10).forEach((entry, i) => {
    const rank = i + 1;
    const medal = getRankEmoji(rank);
    output += `${medal} **${entry.ign}** - ${formatGold(entry.activity_score)} pts\n`;
    output += `   └ Raids: ${entry.total_raids} | Gold: ${formatGold(entry.total_gold)}\n`;
  });

  return output;
}
