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

export function getWeekStart(): string {
  const date = new Date();
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  date.setDate(diff);
  return date.toISOString().split('T')[0];
}

export function getMonthStart(): string {
  const date = new Date();
  date.setDate(1);
  return date.toISOString().split('T')[0];
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
  if (daysInactive < 0) return 'never';
  if (daysInactive === 0) return 'active';
  if (daysInactive >= 7) return '1w+';
  return `${daysInactive}d`;
}

export function getInactivityEmoji(category: string): string {
  switch (category) {
    case '1w+':
    case 'never':
      return '🔴';
    case '4d':
    case '5d':
    case '6d':
      return '🟠';
    case '2d':
    case '3d':
      return '🟡';
    case '1d':
      return '🟢'; // 1 day = green (safe)
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

  const categories = ['1d', '2d', '3d', '4d', '5d', '6d', '1w+', 'never'];

  for (const cat of categories) {
    if (grouped[cat] && grouped[cat].length > 0) {
      const emoji = getInactivityEmoji(cat);
      const label = cat === 'never' ? 'Never Active' : cat;
      output += `${emoji} **${label}**: ${grouped[cat].join(', ')}\n`;
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
