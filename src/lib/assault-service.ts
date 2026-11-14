import { createAdminClient } from '@/lib/supabase-server';
import type { EnemyEntry } from '@/lib/assault-template';

export interface AssaultConfig {
  id: string;
  guild_id: string;
  active: boolean;
  launch_time_utc: string;
  zone_name: string;
  level_range: string;
  shrine_info: string;
  target_mob_count: string;
  enemy_priority: EnemyEntry[];
  discord_guild_id: string | null;
  announcement_channel_id: string | null;
  member_role_id: string | null;
  staff_role_id: string | null;
  skip_date: string | null;
  paused_until: string | null;
  weekdays: number[] | null;
  season_start: string | null;
  season_end: string | null;
  created_at: string;
  updated_at: string;
}

export const DISCORD_ROLES = {
  engineersMember: '1457858167726805154',
  invadersMember: '1444772879483797714',
  engineersStaff: '1457858504156250366',
  invadersStaff: '1450584362264563855',
} as const;

export const GUILD_BY_MEMBER_ROLE: Record<string, { label: string; staffRoleId: string }> = {
  [DISCORD_ROLES.engineersMember]: { label: 'dream engineers', staffRoleId: DISCORD_ROLES.engineersStaff },
  [DISCORD_ROLES.invadersMember]: { label: 'invaders', staffRoleId: DISCORD_ROLES.invadersStaff },
};

export type InferGuildResult =
  | { ok: true; guildLabel: string; memberRoleId: string; staffRoleId: string }
  | { ok: false; reason: 'none' | 'ambiguous'; matchedLabels: string[] };

/** Infer the user's assault guild from Discord member roles.
 *  - Exactly one member role → infer.
 *  - Both member roles → caller must require explicit guild option.
 *  - Neither → reject.
 */
export function inferGuildFromRoles(roles: string[] | undefined): InferGuildResult {
  const roleSet = new Set(roles ?? []);
  const matches = Object.entries(GUILD_BY_MEMBER_ROLE).filter(([rid]) => roleSet.has(rid));
  if (matches.length === 1) {
    const [rid, info] = matches[0];
    return { ok: true, guildLabel: info.label, memberRoleId: rid, staffRoleId: info.staffRoleId };
  }
  return {
    ok: false,
    reason: matches.length === 0 ? 'none' : 'ambiguous',
    matchedLabels: matches.map(([, info]) => info.label),
  };
}

/** Does the given guild's schedule mark `date` as an assault day? */
export function isAssaultDay(
  config: Pick<AssaultConfig, 'weekdays' | 'season_start' | 'season_end' | 'skip_date' | 'paused_until' | 'active'>,
  date: Date = new Date(),
): boolean {
  if (!config.active) return false;
  if (!config.weekdays || config.weekdays.length === 0) return false;
  const dateStr = date.toISOString().slice(0, 10);
  if (config.skip_date === dateStr) return false;
  if (config.paused_until && new Date(config.paused_until).getTime() > date.getTime()) return false;
  if (config.season_start && dateStr < config.season_start) return false;
  if (config.season_end && dateStr > config.season_end) return false;
  const dow = date.getUTCDay();
  return config.weekdays.includes(dow);
}

export interface AssaultPingStep {
  id: string;
  guild_id: string;
  step_key: string;
  label: string;
  offset_minutes: number;
  enabled: boolean;
  mention_roles: string[];
  message_template: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export async function getAssaultConfig(guildId: string): Promise<AssaultConfig | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('assault_configs')
    .select('*')
    .eq('guild_id', guildId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as AssaultConfig | null) ?? null;
}

export async function listAssaultConfigs(): Promise<AssaultConfig[]> {
  const supabase = createAdminClient();
  const { data: assaultGuilds, error: gErr } = await supabase
    .from('guilds')
    .select('id')
    .eq('is_assault', true);
  if (gErr) throw new Error(gErr.message);
  const ids = (assaultGuilds ?? []).map((g: { id: string }) => g.id);
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from('assault_configs')
    .select('*')
    .in('guild_id', ids)
    .order('guild_id');
  if (error) throw new Error(error.message);
  return (data as AssaultConfig[]) ?? [];
}

export async function upsertAssaultConfig(
  guildId: string,
  patch: Partial<Omit<AssaultConfig, 'id' | 'guild_id' | 'created_at' | 'updated_at'>>
): Promise<AssaultConfig> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('assault_configs')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('guild_id', guildId)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as AssaultConfig;
}

export async function listSteps(guildId: string): Promise<AssaultPingStep[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('assault_ping_steps')
    .select('*')
    .eq('guild_id', guildId)
    .order('sort_order', { ascending: true });
  if (error) throw new Error(error.message);
  return (data as AssaultPingStep[]) ?? [];
}

export async function getStep(stepId: string): Promise<AssaultPingStep | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('assault_ping_steps')
    .select('*')
    .eq('id', stepId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as AssaultPingStep | null) ?? null;
}

export async function createStep(
  guildId: string,
  step: Omit<AssaultPingStep, 'id' | 'guild_id' | 'created_at' | 'updated_at'>
): Promise<AssaultPingStep> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('assault_ping_steps')
    .insert({ ...step, guild_id: guildId })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as AssaultPingStep;
}

export async function updateStep(
  stepId: string,
  patch: Partial<Omit<AssaultPingStep, 'id' | 'guild_id' | 'created_at' | 'updated_at'>>
): Promise<AssaultPingStep> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('assault_ping_steps')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', stepId)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as AssaultPingStep;
}

export async function deleteStep(stepId: string): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.from('assault_ping_steps').delete().eq('id', stepId);
  if (error) throw new Error(error.message);
}

export async function reorderSteps(guildId: string, orderedIds: string[]): Promise<void> {
  const supabase = createAdminClient();
  // Simple approach: update sort_order per row
  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabase
      .from('assault_ping_steps')
      .update({ sort_order: (i + 1) * 10, updated_at: new Date().toISOString() })
      .eq('id', orderedIds[i])
      .eq('guild_id', guildId);
    if (error) throw new Error(error.message);
  }
}

export async function isAlreadySent(
  guildId: string,
  stepId: string,
  launchDate: string
): Promise<boolean> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('assault_sent_pings')
    .select('id')
    .eq('guild_id', guildId)
    .eq('step_id', stepId)
    .eq('launch_date', launchDate)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return !!data;
}

export async function markSent(
  guildId: string,
  stepId: string,
  launchDate: string,
  discordMessageId?: string
): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.from('assault_sent_pings').insert({
    guild_id: guildId,
    step_id: stepId,
    launch_date: launchDate,
    discord_message_id: discordMessageId ?? null,
  });
  if (error) throw new Error(error.message);
}

/** Look up the human-facing guild name from guild_config. */
export async function getGuildName(guildId: string): Promise<string> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('guild_config')
    .select('guild_name')
    .eq('guild_id', guildId)
    .maybeSingle();
  return (data?.guild_name as string | undefined) ?? guildId;
}

/** Next scheduled launch (unix seconds) obeying weekdays, season, skip, pause.
 *  Returns null if no launch day falls within the lookahead window. */
export function nextAssaultLaunchUnix(
  config: Pick<AssaultConfig, 'weekdays' | 'season_start' | 'season_end' | 'skip_date' | 'paused_until' | 'active' | 'launch_time_utc'>,
  now: Date = new Date(),
  lookaheadDays = 60,
): number | null {
  if (!config.launch_time_utc) return null;
  const [hh, mm] = config.launch_time_utc.split(':').map((n) => parseInt(n, 10));
  for (let i = 0; i < lookaheadDays; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + i, hh, mm, 0));
    if (d.getTime() <= now.getTime()) continue;
    if (!isAssaultDay(config, d)) continue;
    return Math.floor(d.getTime() / 1000);
  }
  return null;
}

/** Return current UTC HH:MM (no seconds). */
export function nowHHMM(d: Date = new Date()): string {
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** Given config launch_time (HH:MM:SS) and step offset, compute fire HH:MM for today. */
export function computeFireHHMM(launchTimeUtc: string, offsetMinutes: number, baseDate: Date = new Date()): string {
  const [hh, mm] = launchTimeUtc.split(':').map(n => parseInt(n, 10));
  const d = new Date(Date.UTC(
    baseDate.getUTCFullYear(),
    baseDate.getUTCMonth(),
    baseDate.getUTCDate(),
    hh, mm, 0
  ));
  d.setUTCMinutes(d.getUTCMinutes() + offsetMinutes);
  const fhh = String(d.getUTCHours()).padStart(2, '0');
  const fmm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${fhh}:${fmm}`;
}
