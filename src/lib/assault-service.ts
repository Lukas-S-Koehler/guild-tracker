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
  created_at: string;
  updated_at: string;
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
  const { data, error } = await supabase
    .from('assault_configs')
    .select('*')
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
