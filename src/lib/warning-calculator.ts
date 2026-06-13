export type WarningLevel = 'safe' | 'warn1' | 'warn2' | 'kick';
export type RequirementPeriod = 'daily' | 'weekly';

export interface WarningInfo {
  category: string;
  warning_level: WarningLevel;
}

/**
 * For weekly guilds: days_inactive includes the 7-day grace window.
 * 8 days inactive = effectively 1 day (warn threshold starts after 1 full week).
 */
export function getEffectiveDaysInactive(
  daysInactive: number,
  period: RequirementPeriod
): number {
  if (period === 'weekly') return Math.max(0, daysInactive - 7);
  return daysInactive;
}

export function getWarningInfo(
  daysInactive: number,
  period: RequirementPeriod = 'daily'
): WarningInfo {
  const effective = getEffectiveDaysInactive(daysInactive, period);

  if (effective === 0) return { category: 'active', warning_level: 'safe' };
  if (effective === 1) return { category: '1d', warning_level: 'safe' };
  if (effective === 2) return { category: '2d', warning_level: 'warn1' };
  if (effective === 3) return { category: '3d', warning_level: 'warn2' };
  return { category: '4d+', warning_level: 'kick' };
}

/**
 * Given deposit totals grouped by ISO week (key = "YYYY-WW"), find the most
 * recent week where the member met the weekly requirement.
 * Returns the Sunday (end of that week) as a Date, or null if none found.
 */
export function findLastMetWeek(
  weeklyDeposits: Record<string, number>,
  weeklyRequirement: number
): Date | null {
  const qualifyingWeeks = Object.entries(weeklyDeposits)
    .filter(([, total]) => total >= weeklyRequirement)
    .map(([week]) => week)
    .sort()
    .reverse();

  if (qualifyingWeeks.length === 0) return null;

  // Parse "YYYY-WW" → ISO week → get that week's Sunday
  const [yearStr, weekStr] = qualifyingWeeks[0].split('-W');
  const year = parseInt(yearStr);
  const week = parseInt(weekStr);

  // Jan 4 is always in week 1; find Monday of week 1
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dayOfWeek = jan4.getUTCDay() || 7; // Mon=1..Sun=7
  const monday1 = new Date(jan4);
  monday1.setUTCDate(jan4.getUTCDate() - dayOfWeek + 1);

  // Monday of target week
  const targetMonday = new Date(monday1);
  targetMonday.setUTCDate(monday1.getUTCDate() + (week - 1) * 7);

  // Sunday of target week
  const targetSunday = new Date(targetMonday);
  targetSunday.setUTCDate(targetMonday.getUTCDate() + 6);

  return targetSunday;
}

/**
 * Get ISO week key "YYYY-WW" from a date string.
 */
export function getISOWeekKey(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  const dayOfWeek = d.getUTCDay() || 7; // Mon=1..Sun=7
  const thursday = new Date(d);
  thursday.setUTCDate(d.getUTCDate() - dayOfWeek + 4);
  const year = thursday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const jan4Monday = new Date(jan4);
  jan4Monday.setUTCDate(jan4.getUTCDate() - jan4Day + 1);
  const weekNum = Math.ceil((thursday.getTime() - jan4Monday.getTime()) / 604800000) + 1;
  return `${year}-W${String(weekNum).padStart(2, '0')}`;
}

/** Get Monday date string (YYYY-MM-DD) for an ISO week key. */
export function getWeekStart(weekKey: string): string {
  const [yearStr, weekStr] = weekKey.split('-W');
  const year = parseInt(yearStr);
  const week = parseInt(weekStr);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dayOfWeek = jan4.getUTCDay() || 7;
  const monday1 = new Date(jan4);
  monday1.setUTCDate(jan4.getUTCDate() - dayOfWeek + 1);
  const targetMonday = new Date(monday1);
  targetMonday.setUTCDate(monday1.getUTCDate() + (week - 1) * 7);
  return targetMonday.toISOString().split('T')[0];
}

/** Get Sunday date string (YYYY-MM-DD) for an ISO week key. */
export function getWeekSunday(weekKey: string): string {
  const monday = getWeekStart(weekKey);
  const d = new Date(monday + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().split('T')[0];
}

/** All ISO week keys from startWeek to endWeek inclusive (chronological order). */
export function getWeekKeyRange(startWeek: string, endWeek: string): string[] {
  const result: string[] = [];
  const startDate = new Date(getWeekStart(startWeek) + 'T00:00:00Z');
  const endDate = new Date(getWeekStart(endWeek) + 'T00:00:00Z');
  const cur = new Date(startDate);
  while (cur <= endDate) {
    result.push(getISOWeekKey(cur.toISOString().split('T')[0]));
    cur.setUTCDate(cur.getUTCDate() + 7);
  }
  return result;
}
