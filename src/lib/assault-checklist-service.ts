import { createAdminClient } from '@/lib/supabase-server';
import type { CombatPotion, XpPotion, Loadout } from '@/lib/potion-rules';
import { computeActivationMinutes, getSlotState } from '@/lib/potion-rules';

export interface ChecklistItem {
  id?: string;
  guild_id?: string;
  item_key: string;
  label: string;
  description: string | null;
  phase: string;
  sort_order: number;
  enabled: boolean;
  anchor_minutes?: number | null;
  potion_slot?: 'combat_combined' | 'combat_xp' | 'battle_xp' | null;
  /** Rendered absolute time label for this launch (e.g. "launch−30m" or "18:30 UTC"). NULL = no absolute time. */
  time_label?: string | null;
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

/** Load the global checklist template (enabled rows, sorted). */
export async function getChecklistTemplate(): Promise<ChecklistItem[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('assault_checklist_template')
    .select('*')
    .eq('enabled', true)
    .order('sort_order');
  if (error) throw new Error(error.message);
  return (data as ChecklistItem[]) ?? [];
}

/** Legacy: per-guild items table. Retained for now; prefer getChecklistTemplate. */
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

function fmtOffset(offset: number): string {
  if (offset === 0) return 'launch';
  const abs = Math.abs(offset);
  const sign = offset < 0 ? '−' : '+';
  if (abs >= 60) {
    const h = Math.floor(abs / 60);
    const m = abs % 60;
    return `launch${sign}${h}h${m ? `${m}m` : ''}`;
  }
  return `launch${sign}${abs}m`;
}

function fmtClock(launchTimeUtc: string | null, offsetMinutes: number): string | null {
  if (!launchTimeUtc) return null;
  const [hh, mm] = launchTimeUtc.split(':').map((n) => parseInt(n, 10));
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
  const totalMinutes = ((hh * 60 + mm + offsetMinutes) % (24 * 60) + 24 * 60) % (24 * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} UTC`;
}

/** Merge the global template with a potion loadout, producing a chronological checklist
 *  with absolute time labels when launchTimeUtc is known.
 *  Potion-slot rows drop out if the loadout doesn't fill them.
 */
export function buildTimedChecklist(
  template: ChecklistItem[],
  loadout: Loadout | null,
  combat: CombatPotion[],
  xp: XpPotion[],
  launchTimeUtc: string | null,
): ChecklistItem[] {
  const slotState = loadout ? getSlotState(loadout, combat, xp) : null;

  const activationMinutes = (slot: 'combat_combined' | 'combat_xp' | 'battle_xp'): number | null => {
    if (!slotState) return null;
    if (slot === 'combat_combined') {
      // attack & protection share duration when paired; use whichever present
      const dur = slotState.attack?.duration_minutes ?? slotState.protection?.duration_minutes ?? null;
      return computeActivationMinutes(dur);
    }
    if (slot === 'combat_xp') return computeActivationMinutes(slotState.combat_xp?.duration_minutes ?? null);
    if (slot === 'battle_xp') return computeActivationMinutes(slotState.battle_xp?.duration_minutes ?? null);
    return null;
  };

  const potionLabel = (slot: 'combat_combined' | 'combat_xp' | 'battle_xp'): string | null => {
    if (!slotState) return null;
    if (slot === 'combat_combined') {
      const names = [slotState.attack?.name, slotState.protection?.name].filter(Boolean);
      return names.length ? names.join(' + ') : null;
    }
    if (slot === 'combat_xp') return slotState.combat_xp?.name ?? null;
    if (slot === 'battle_xp') return slotState.battle_xp?.name ?? null;
    return null;
  };

  const rows: (ChecklistItem & { _effectiveOffset: number | null })[] = [];
  for (const t of template) {
    let offset: number | null = t.anchor_minutes ?? null;
    let label = t.label;
    if (t.potion_slot) {
      const act = activationMinutes(t.potion_slot);
      if (act == null) continue; // skip potion rows with no matching loadout entry
      offset = act;
      const pname = potionLabel(t.potion_slot);
      if (pname) label = `${t.label}: ${pname}`;
    }
    const clock = offset != null ? fmtClock(launchTimeUtc, offset) : null;
    const offsetLabel = offset != null ? fmtOffset(offset) : null;
    const time_label = offset != null
      ? (clock ? `${clock} (${offsetLabel})` : offsetLabel)
      : null;
    rows.push({ ...t, label, time_label, _effectiveOffset: offset });
  }

  rows.sort((a, b) => {
    const ao = a._effectiveOffset;
    const bo = b._effectiveOffset;
    if (ao == null && bo == null) return a.sort_order - b.sort_order;
    if (ao == null) return 1;
    if (bo == null) return -1;
    if (ao !== bo) return ao - bo;
    return a.sort_order - b.sort_order;
  });

  return rows.map(({ _effectiveOffset: _o, ...rest }) => rest);
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
