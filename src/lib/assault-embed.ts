import { formatGold } from '@/lib/utils';

/** Shared look & feel for assault Discord output (commands + stat crons). */

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://guild-tracker-9ys7-blond.vercel.app').replace(/\/$/, '');

export const siteUrl = (path = '/assault') => `${SITE_URL}${path}`;

export const COLORS = {
  orange: 0xff6b35, // interim / stats
  green: 0x22c55e, // final
  amber: 0xf59e0b, // plan
  purple: 0x8b5cf6, // conquest
  blue: 0x3b82f6, // status / info
} as const;

export const medal = (i: number) => (['🥇', '🥈', '🥉'][i] ?? `**${i + 1}.**`);

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

/** Discord "link button" row pointing at a website page. */
export function linkRow(path = '/assault', label = 'View on website'): unknown {
  return { type: 1, components: [{ type: 2, style: 5, label: `🌐 ${label}`.slice(0, 80), url: siteUrl(path) }] };
}

/** Pad/truncate for monospace tables. */
export const padR = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n));
export const padL = (s: string, n: number) => s.padStart(n);

export interface RankedEntry {
  name: string;
  level?: number | null;
  experience: number;
  kills: number;
}

/** Podium (top 3, bold, with share %) + compact lines for the rest. */
export function podium(entries: RankedEntry[], opts: { max?: number; totalXp?: number } = {}): string {
  const max = opts.max ?? 10;
  const total = opts.totalXp ?? entries.reduce((a, e) => a + e.experience, 0);
  const share = (xp: number) => (total > 0 ? ` · ${Math.round((xp / total) * 100)}%` : '');
  const shown = entries.slice(0, max);
  const top = shown.slice(0, 3).map((e, i) =>
    `${medal(i)} **${e.name}**${e.level ? ` *(Lv ${e.level})*` : ''}\n> ${formatGold(e.experience)} XP${share(e.experience)} · ${e.kills.toLocaleString()} kills`);
  const rest = shown.slice(3).map((e, i) =>
    `\`${String(i + 4).padStart(2)}.\` ${e.name} — ${formatGold(e.experience)} XP · ${e.kills.toLocaleString()} kills`);
  return [top.join('\n'), rest.join('\n')].filter(Boolean).join('\n\n');
}

/** Three inline stat fields in a row. */
export function statFields(stats: Array<[string, string]>): Array<{ name: string; value: string; inline: true }> {
  return stats.map(([name, value]) => ({ name, value, inline: true as const }));
}
