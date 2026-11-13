export interface AssaultConfigLite {
  guild_id: string;
  zone_name: string;
  level_range: string;
  shrine_info: string;
  target_mob_count: string;
  enemy_priority: EnemyEntry[];
  member_role_id: string | null;
  staff_role_id: string | null;
}

export interface EnemyEntry {
  name: string;
  level: number;
  gold_per_hr: number;
}

export interface TemplateVars {
  member_role: string;
  staff_role: string;
  guild_name: string;
  zone_name: string;
  level_range: string;
  shrine_info: string;
  target_mob_count: string;
  mob_order: string;
  launch_timestamp: string;
  launch_relative: string;
}

/** Substitute {{var}} tokens. Unknown vars rendered as empty string. */
export function renderTemplate(template: string, vars: Partial<TemplateVars>): string {
  return template.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (_m, key) => {
    const v = (vars as Record<string, unknown>)[key];
    return v == null ? '' : String(v);
  });
}

/** Format enemy priority as a readable kill-order string. */
export function formatMobOrder(enemies: EnemyEntry[]): string {
  if (!enemies || enemies.length === 0) return '(none set)';
  return enemies
    .map((e, i) => `${i + 1}. ${e.name} Lvl ${e.level} — ${e.gold_per_hr.toLocaleString()}g/h`)
    .join(', ');
}

/** Build the full variable set for a given launch moment. */
export function buildTemplateVars(
  config: AssaultConfigLite,
  guildName: string,
  launchUnixSeconds: number
): TemplateVars {
  return {
    member_role: config.member_role_id ? `<@&${config.member_role_id}>` : '',
    staff_role: config.staff_role_id ? `<@&${config.staff_role_id}>` : '',
    guild_name: guildName,
    zone_name: config.zone_name,
    level_range: config.level_range,
    shrine_info: config.shrine_info,
    target_mob_count: config.target_mob_count,
    mob_order: formatMobOrder(config.enemy_priority ?? []),
    launch_timestamp: `<t:${launchUnixSeconds}:t>`,
    launch_relative: `<t:${launchUnixSeconds}:R>`,
  };
}

/**
 * Compute today's launch unix seconds (UTC) given a HH:MM:SS launch_time.
 * `nowUtc` defaults to current time.
 */
export function todayLaunchUnix(launchTimeUtc: string, nowUtc: Date = new Date()): number {
  const [hh, mm, ss] = launchTimeUtc.split(':').map(n => parseInt(n, 10));
  const d = new Date(Date.UTC(
    nowUtc.getUTCFullYear(),
    nowUtc.getUTCMonth(),
    nowUtc.getUTCDate(),
    hh, mm, ss || 0
  ));
  return Math.floor(d.getTime() / 1000);
}

/** YYYY-MM-DD in UTC — used as launch_date for dedup. */
export function utcDateString(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}
