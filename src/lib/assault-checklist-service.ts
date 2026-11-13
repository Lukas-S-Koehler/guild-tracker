import { createAdminClient } from '@/lib/supabase-server';

export interface ChecklistItem {
  id: string;
  guild_id: string;
  item_key: string;
  label: string;
  description: string | null;
  phase: string;
  sort_order: number;
  enabled: boolean;
}

/** Compute current launch_date for a guild (UTC) based on launch_time_utc.
 *  Returns the date of the most recent launch moment that is <= now.
 */
export function computeLaunchDate(launchTimeUtc: string, now: Date = new Date()): string {
  const [h, m] = launchTimeUtc.split(':').map((n) => parseInt(n, 10));
  const launchToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, m, 0));
  const base = launchToday.getTime() <= now.getTime() ? launchToday : new Date(launchToday.getTime() - 24 * 60 * 60 * 1000);
  return base.toISOString().slice(0, 10);
}

export async function getChecklistItems(guildId: string): Promise<ChecklistItem[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('assault_checklist_items')
    .select('*')
    .eq('guild_id', guildId)
    .eq('enabled', true)
    .order('sort_order');
  if (error) throw new Error(error.message);
  return (data as ChecklistItem[]) ?? [];
}

export async function getChecklistProgress(userId: string, guildId: string, launchDate: string) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('assault_checklist_progress')
    .select('item_key, checked_at, source')
    .eq('user_id', userId)
    .eq('guild_id', guildId)
    .eq('launch_date', launchDate);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function toggleChecklistItem(
  userId: string,
  guildId: string,
  launchDate: string,
  itemKey: string,
  checked: boolean,
  source: 'web' | 'discord' = 'web',
): Promise<void> {
  const supabase = createAdminClient();
  if (checked) {
    const { error } = await supabase.from('assault_checklist_progress').upsert(
      { user_id: userId, guild_id: guildId, launch_date: launchDate, item_key: itemKey, source, checked_at: new Date().toISOString() },
      { onConflict: 'user_id,guild_id,launch_date,item_key' },
    );
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase
      .from('assault_checklist_progress')
      .delete()
      .eq('user_id', userId)
      .eq('guild_id', guildId)
      .eq('launch_date', launchDate)
      .eq('item_key', itemKey);
    if (error) throw new Error(error.message);
  }
}

export async function resetChecklist(userId: string, guildId: string, launchDate: string): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('assault_checklist_progress')
    .delete()
    .eq('user_id', userId)
    .eq('guild_id', guildId)
    .eq('launch_date', launchDate);
  if (error) throw new Error(error.message);
}

export async function getLaunchDateForGuild(guildId: string): Promise<string> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('assault_configs')
    .select('launch_time_utc')
    .eq('guild_id', guildId)
    .maybeSingle();
  const launchTime = (data?.launch_time_utc as string) ?? '18:00:00';
  return computeLaunchDate(launchTime);
}
