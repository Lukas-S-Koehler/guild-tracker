/**
 * Holiday system (`/away`, Dream Hub step 8).
 *
 * A period covers a whole account (every character with the Discord id + their alt bundle).
 * Self-serve up to MAX_AWAY_DAYS; staff can set or end one for people ranked below them.
 * While active: the character is skipped by the daily check (no warning, no DM, not on the board
 * or in inactivity reports). Afterwards, inactivity counts from the end date, so nobody comes
 * back to an instant kick notice.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAccountMemberIds } from '@/lib/alt-graph';
import { DAY_BOUNDARY_OFFSET_MINUTES } from '@/lib/activity-processor';

export const MAX_AWAY_DAYS = 14;
export const HOLIDAY_LOG_CHANNEL = '1456648703870898354';
/** How far back an ended period still shifts the inactivity start. Longer than the kick threshold. */
const COVER_LOOKBACK_DAYS = 30;

export interface AwayPeriod {
  id: string;
  discord_id: string;
  member_ids: string[];
  starts_on: string;
  ends_on: string;
  reason: string | null;
  created_by_discord_id: string | null;
  ended_at: string | null;
}

/** Current game day (same as me-summary's gameDayOf; kept here to avoid an import cycle). */
const gameDayOf = (d = new Date()) => new Date(d.getTime() - DAY_BOUNDARY_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);

const addDays = (date: string, n: number) => new Date(new Date(date + 'T00:00:00Z').getTime() + n * 86_400_000).toISOString().slice(0, 10);

/** Characters for a Discord user: everyone with that discord_id plus their alt bundle. */
export async function accountForDiscord(supabase: SupabaseClient, discordId: string) {
  const { data } = await supabase.from('members').select('id').eq('discord_id', discordId).eq('is_active', true);
  const seeds = (data ?? []).map((m) => m.id as string);
  if (!seeds.length) return [];
  return Array.from(await getAccountMemberIds(supabase, seeds));
}

export async function getActiveAway(supabase: SupabaseClient, discordId: string, day = gameDayOf()): Promise<AwayPeriod | null> {
  const { data } = await supabase
    .from('away_periods')
    .select('*')
    .eq('discord_id', discordId)
    .is('ended_at', null)
    .lte('starts_on', day)
    .gte('ends_on', day)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as AwayPeriod | null) ?? null;
}

/** Start (or replace) a period. `days` = days away including today. */
export async function setAway(
  supabase: SupabaseClient,
  opts: { discordId: string; days: number; reason: string | null; by: string }
): Promise<{ period: AwayPeriod } | { error: string }> {
  const memberIds = await accountForDiscord(supabase, opts.discordId);
  if (!memberIds.length) return { error: 'No tracked characters are linked to this Discord account. Run /claim, or ask an officer to /map you.' };
  const today = gameDayOf();
  // One period at a time: a new one replaces the current.
  await supabase.from('away_periods').update({ ended_at: new Date().toISOString() }).eq('discord_id', opts.discordId).is('ended_at', null).gte('ends_on', today);
  const { data, error } = await supabase
    .from('away_periods')
    .insert({
      discord_id: opts.discordId,
      member_ids: memberIds,
      starts_on: today,
      ends_on: addDays(today, opts.days - 1),
      reason: opts.reason,
      created_by_discord_id: opts.by,
    })
    .select('*')
    .single();
  if (error) return { error: error.message };
  return { period: data as AwayPeriod };
}

/** End early: the period now ends yesterday, so today counts again. */
export async function endAway(supabase: SupabaseClient, discordId: string): Promise<AwayPeriod | null> {
  const cur = await getActiveAway(supabase, discordId);
  if (!cur) return null;
  const today = gameDayOf();
  const end = cur.starts_on === today ? today : addDays(today, -1);
  const { data } = await supabase
    .from('away_periods')
    .update({ ended_at: new Date().toISOString(), ends_on: end })
    .eq('id', cur.id)
    .select('*')
    .single();
  return (data as AwayPeriod | null) ?? cur;
}

export async function listActiveAway(supabase: SupabaseClient): Promise<AwayPeriod[]> {
  const today = gameDayOf();
  const { data } = await supabase.from('away_periods').select('*').lte('starts_on', today).gte('ends_on', today).order('ends_on');
  return (data ?? []) as AwayPeriod[];
}

export interface AwayCover {
  /** member_id → last away day, for periods covering `day`. Skip these. */
  active: Map<string, string>;
  /** member_id → last away day of a recent finished period. Count inactivity from there. */
  endedOn: Map<string, string>;
}

/** Away state for the daily check / inactivity report, as of game day `day` (YYYY-MM-DD). */
export async function loadAwayCover(supabase: SupabaseClient, day: string): Promise<AwayCover> {
  const { data, error } = await supabase
    .from('away_periods')
    .select('member_ids, starts_on, ends_on')
    .lte('starts_on', day)
    .gte('ends_on', addDays(day, -COVER_LOOKBACK_DAYS));
  const active = new Map<string, string>();
  const endedOn = new Map<string, string>();
  if (error) {
    console.error('[away] loadAwayCover:', error.message);
    return { active, endedOn };
  }
  for (const p of data ?? []) {
    const target = p.ends_on >= day ? active : endedOn;
    for (const id of p.member_ids as string[]) {
      const prev = target.get(id);
      if (!prev || p.ends_on > prev) target.set(id, p.ends_on);
    }
  }
  return { active, endedOn };
}

/** Later of the real last activity and the end of a finished away period. */
export function withAwayEnd(lastDate: string | undefined, memberId: string, cover: AwayCover): string | undefined {
  const end = cover.endedOn.get(memberId);
  if (!end) return lastDate;
  return !lastDate || end > lastDate ? end : lastDate;
}

export const awayUnix = (endsOn: string) => Math.floor(new Date(addDays(endsOn, 1) + 'T00:00:00Z').getTime() / 1000);
