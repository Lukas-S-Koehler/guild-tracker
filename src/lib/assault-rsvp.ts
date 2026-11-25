/**
 * Assault RSVP per wave (docs/assault-roster.md §7).
 * auto    = counted "in" unless they answered maybe/out
 * opt_in  = counted only once they answer "in" (no answer = "no reply")
 * none    = not assaulting, never counted
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase-server';
import { getAssaultConfig, nextAssaultLaunchUnix } from '@/lib/assault-service';

export type RsvpStatus = 'in' | 'maybe' | 'out';
export type EffectiveRsvp = RsvpStatus | 'no_reply' | 'none';
export const RSVP_STATUSES: RsvpStatus[] = ['in', 'maybe', 'out'];

export function effectiveRsvp(participation: 'auto' | 'opt_in' | 'none', answer: RsvpStatus | null): EffectiveRsvp {
  if (participation === 'none') return 'none';
  if (answer) return answer;
  return participation === 'auto' ? 'in' : 'no_reply';
}

/** Next wave (launch unix) for an assault guild, or null when none is scheduled. */
export async function nextWaveUnix(guildId: string): Promise<number | null> {
  const config = await getAssaultConfig(guildId);
  if (!config || !config.active) return null;
  return nextAssaultLaunchUnix(config);
}

export async function rsvpsForWave(guildId: string, waveUnix: number, supabase: SupabaseClient = createAdminClient()) {
  const { data } = await supabase.from('assault_rsvps').select('member_id, status').eq('guild_id', guildId).eq('wave_unix', waveUnix);
  return new Map((data ?? []).map((r) => [r.member_id as string, r.status as RsvpStatus]));
}

export async function setRsvp(
  args: { guildId: string; waveUnix: number; memberIds: string[]; status: RsvpStatus | null; source: 'web' | 'discord'; userId?: string | null; discordId?: string | null },
  supabase: SupabaseClient = createAdminClient()
) {
  if (!args.memberIds.length) return;
  if (args.status == null) {
    await supabase.from('assault_rsvps').delete().eq('guild_id', args.guildId).eq('wave_unix', args.waveUnix).in('member_id', args.memberIds);
    return;
  }
  const now = new Date().toISOString();
  const { error } = await supabase.from('assault_rsvps').upsert(
    args.memberIds.map((m) => ({
      guild_id: args.guildId, wave_unix: args.waveUnix, member_id: m, status: args.status,
      source: args.source, updated_by: args.userId ?? null, discord_id: args.discordId ?? null, updated_at: now,
    })),
    { onConflict: 'guild_id,wave_unix,member_id' }
  );
  if (error) throw new Error(error.message);
}
