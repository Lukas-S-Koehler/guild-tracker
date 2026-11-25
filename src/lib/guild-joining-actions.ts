/**
 * Start / extend / end the "joining" state (see src/lib/guild-joining.ts). Every change re-applies
 * the side effects right away so staff don't wait for a cron: website role (derived recompute),
 * Discord roles, and the assault roster row.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { findBundleLocks, recomputeUserGuildAccess } from '@/lib/account-service';
import { syncDiscordUser } from '@/lib/discord-roles';
import { syncAssaultRoster } from '@/lib/assault-roster-sync';
import { postToChannelRich } from '@/lib/discord-api';
import { INTEREST_CHANNEL_ID } from '@/lib/assault-eligibility';
import { JOINING_HOURS } from '@/lib/guild-joining';
import type { Actor } from '@/lib/recruit-service';

const HOUR_MS = 3_600_000;
const esc = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

type MemberLite = { id: string; ign: string; discord_id: string | null; current_guild_id: string | null; is_active: boolean | null };

async function memberByIgn(supabase: SupabaseClient, ign: string): Promise<MemberLite | null> {
  const { data } = await supabase
    .from('members')
    .select('id, ign, discord_id, current_guild_id, is_active')
    .ilike('ign', esc(ign.trim()))
    .order('synced_at', { ascending: false, nullsFirst: false })
    .limit(1);
  return ((data ?? [])[0] as MemberLite | undefined) ?? null;
}

/** Website role, Discord roles and roster row for one character, best effort. */
async function applySideEffects(supabase: SupabaseClient, memberId: string, discordId: string | null, rosterGuildId: string | null) {
  const tasks: Promise<unknown>[] = [];
  tasks.push(
    (async () => {
      const { locks } = await findBundleLocks(memberId, supabase);
      const owners = new Set(locks.filter((l) => l.status === 'approved').map((l) => l.user_id));
      for (const u of Array.from(owners)) await recomputeUserGuildAccess(u, supabase);
    })()
  );
  if (discordId) tasks.push(syncDiscordUser(supabase, discordId));
  if (rosterGuildId) tasks.push(syncAssaultRoster({ memberIds: [memberId], minAgeMs: 0, budgetMs: 25_000 }));
  const res = await Promise.allSettled(tasks);
  for (const r of res) if (r.status === 'rejected') console.error('[guild-joining] side effect failed:', r.reason);
}

async function isAssaultGuild(supabase: SupabaseClient, guildId: string) {
  const { data } = await supabase.from('guilds').select('is_assault').eq('id', guildId).maybeSingle();
  return !!data?.is_assault;
}

export type JoinResult = { ok: true; ign: string; until: string } | { ok: false; error: string; status: number };

/** Mark a character as joining a Dream guild. Creates/updates the Recruiting prospect. */
export async function startJoining(
  supabase: SupabaseClient,
  input: { ign: string; guild_id: string; hours?: number },
  actor: Actor
): Promise<JoinResult> {
  const { data: guild } = await supabase.from('guilds').select('id, name, nickname').eq('id', input.guild_id).maybeSingle();
  if (!guild) return { ok: false, error: 'Unknown guild', status: 400 };
  const member = await memberByIgn(supabase, input.ign);
  if (!member) {
    return { ok: false, error: `${input.ign} isn't in our members list yet (never synced in a Dream guild). Add them once they've joined.`, status: 404 };
  }
  if (member.current_guild_id === input.guild_id && member.is_active !== false) {
    return { ok: false, error: `${member.ign} is already in ${guild.nickname ?? guild.name}.`, status: 409 };
  }

  const now = new Date();
  const until = new Date(now.getTime() + Math.min(Math.max(input.hours ?? JOINING_HOURS, 1), 168) * HOUR_MS).toISOString();
  const { data: existing } = await supabase.from('recruit_prospects').select('id, status, replied_at').ilike('ign', esc(member.ign)).maybeSingle();
  const patch: Record<string, unknown> = {
    ign: member.ign,
    status: 'replied',
    recheck_after: null,
    replied_at: existing?.replied_at ?? now.toISOString(),
    joined_at: null,
    joined_guild_id: null,
    joining_member_id: member.id,
    joining_guild_id: input.guild_id,
    joining_until: until,
    joining_at: now.toISOString(),
    joining_by_name: actor.name,
    updated_by: actor.id,
    updated_by_name: actor.name,
    updated_at: now.toISOString(),
  };
  const q = existing
    ? supabase.from('recruit_prospects').update(patch).eq('id', existing.id)
    : supabase.from('recruit_prospects').insert(patch);
  const { error } = await q;
  if (error) return { ok: false, error: error.message, status: 500 };

  await applySideEffects(supabase, member.id, member.discord_id, (await isAssaultGuild(supabase, input.guild_id)) ? input.guild_id : null);
  return { ok: true, ign: member.ign, until };
}

/** Push the deadline out by `hours` from now (or from the current deadline if later). */
export async function extendJoining(supabase: SupabaseClient, prospectId: string, hours: number, actor: Actor): Promise<JoinResult> {
  const { data: p } = await supabase.from('recruit_prospects').select('ign, joining_until, joining_member_id').eq('id', prospectId).maybeSingle();
  if (!p?.joining_member_id) return { ok: false, error: 'Not joining', status: 404 };
  const base = Math.max(Date.now(), p.joining_until ? Date.parse(p.joining_until) : 0);
  const until = new Date(base + Math.min(Math.max(hours, 1), 168) * HOUR_MS).toISOString();
  const { error } = await supabase
    .from('recruit_prospects')
    .update({ joining_until: until, updated_by: actor.id, updated_by_name: actor.name, updated_at: new Date().toISOString() })
    .eq('id', prospectId);
  if (error) return { ok: false, error: error.message, status: 500 };
  return { ok: true, ign: p.ign, until };
}

/** Clear the joining state (cancel, expiry or the move landed) and re-apply roles. */
export async function endJoining(supabase: SupabaseClient, prospectId: string, actor: Actor | null): Promise<void> {
  const { data: p } = await supabase.from('recruit_prospects').select('joining_member_id').eq('id', prospectId).maybeSingle();
  const memberId = p?.joining_member_id as string | null;
  await supabase
    .from('recruit_prospects')
    .update({
      joining_member_id: null, joining_guild_id: null, joining_until: null,
      ...(actor ? { updated_by: actor.id, updated_by_name: actor.name } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', prospectId);
  if (!memberId) return;
  const { data: m } = await supabase.from('members').select('discord_id').eq('id', memberId).maybeSingle();
  // Roster row of a cancelled join is dropped by the next full roster sync.
  await applySideEffects(supabase, memberId, (m?.discord_id as string | null) ?? null, null);
}

/**
 * Cron: joins whose window ran out without the move landing. Clears them and posts one note to
 * leadership-chat (no ping). Run before the access recompute so roles drop in the same pass.
 */
export async function expireJoins(supabase: SupabaseClient): Promise<number> {
  const { data, error } = await supabase
    .from('recruit_prospects')
    .select('id, ign, joining_guild_id, joining_member_id')
    .not('joining_member_id', 'is', null)
    .lte('joining_until', new Date().toISOString());
  if (error || !data?.length) return 0;
  const { data: guilds } = await supabase.from('guilds').select('id, name, nickname');
  const gName = new Map((guilds ?? []).map((g) => [String(g.id), (g.nickname ?? g.name) as string]));
  for (const p of data) await endJoining(supabase, p.id as string, null);
  const lines = data.map((p) => `• **${p.ign}** → ${gName.get(String(p.joining_guild_id)) ?? 'a guild'}`);
  await postToChannelRich(INTEREST_CHANNEL_ID, {
    content: [`⌛ Joining window ran out before the guild move showed up in game:`, ...lines, 'Their temporary access was removed. Mark them as joining again on the Recruiting tab if they still need time.'].join('\n'),
    allowed_mentions: { parse: [] },
  }).catch(() => null);
  return data.length;
}
