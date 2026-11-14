import { createAdminClient } from '@/lib/supabase-server';

/** Personal (Discord-user-keyed) checklist state. launch_date is the chronological bucket
 *  — derived from the user's inferred guild launch time, or "personal" when off-season/base mode.
 */

export async function getDiscordChecked(
  discordUserId: string,
  launchDate: string,
): Promise<Set<string>> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('assault_checklist_discord_state')
    .select('item_key')
    .eq('discord_user_id', discordUserId)
    .eq('launch_date', launchDate);
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((r) => r.item_key as string));
}

export async function toggleDiscordItem(
  discordUserId: string,
  launchDate: string,
  itemKey: string,
): Promise<boolean> {
  const supabase = createAdminClient();
  const { data: existing } = await supabase
    .from('assault_checklist_discord_state')
    .select('item_key')
    .eq('discord_user_id', discordUserId)
    .eq('launch_date', launchDate)
    .eq('item_key', itemKey)
    .maybeSingle();
  if (existing) {
    const { error } = await supabase
      .from('assault_checklist_discord_state')
      .delete()
      .eq('discord_user_id', discordUserId)
      .eq('launch_date', launchDate)
      .eq('item_key', itemKey);
    if (error) throw new Error(error.message);
    return false;
  }
  const { error } = await supabase
    .from('assault_checklist_discord_state')
    .insert({ discord_user_id: discordUserId, launch_date: launchDate, item_key: itemKey });
  if (error) throw new Error(error.message);
  return true;
}

export async function resetDiscord(
  discordUserId: string,
  launchDate: string,
): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('assault_checklist_discord_state')
    .delete()
    .eq('discord_user_id', discordUserId)
    .eq('launch_date', launchDate);
  if (error) throw new Error(error.message);
}
