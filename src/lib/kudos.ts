/**
 * Kudos (Dream Hub step 14, F7). Members thank each other with a short reason.
 *
 * Rules (user decisions 2026-11-24):
 *  - Givers are website users with an approved claim; the whole account bundle is one giver.
 *  - 3 kudos per giver per week (Monday 00:00 UTC), at most 1 per recipient ACCOUNT per week,
 *    never to your own account (alts included). Reason required, 3–200 characters.
 *  - Given on Discord (`/kudos give`) or with the button on a profile (/p/[ign]); same table.
 *  - Received kudos feed the Community achievements (metric `kudos`, see achievements.ts).
 *  - Weekly shoutout: live key `kudos-weekly` (mode append, bind to #hall-of-fame), posted once
 *    for the last completed week by /api/cron/discord-live from Monday on.
 * Table: database/kudos.sql.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getActiveClaim } from '@/lib/account-service';
import { getAccountKeys, getAccountMemberIds } from '@/lib/alt-graph';
import { getLiveRow, publishLive, textPayloads, type LivePayload, type PublishResult } from '@/lib/discord-live';
import { GUIDE_SITE_URL } from '@/lib/game-guide';

export const KUDOS_PER_WEEK = 3;
export const REASON_MIN = 3;
export const REASON_MAX = 200;
export const KUDOS_WEEKLY_KEY = 'kudos-weekly';

const DAY = 86_400_000;
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Monday (UTC) of the week containing `d`, as YYYY-MM-DD. */
export function weekStartOf(d: Date = new Date()): string {
  const day = d.getUTCDay();
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - (day === 0 ? 6 : day - 1)));
  return monday.toISOString().slice(0, 10);
}

const addDays = (date: string, n: number) => new Date(Date.parse(date) + n * DAY).toISOString().slice(0, 10);

/** One line, trimmed, collapsed whitespace. */
export const cleanReason = (s: string) => s.replace(/\s+/g, ' ').trim();

// ─── Giver ───────────────────────────────────────────────────────────────────

interface Giver {
  userId: string;
  memberId: string;
  ign: string;
  accountIds: Set<string>;
}

async function loadGiver(supabase: SupabaseClient, userId: string): Promise<Giver | null> {
  const claim = await getActiveClaim(userId, supabase);
  if (!claim || claim.status !== 'approved') return null;
  return {
    userId,
    memberId: claim.member_id as string,
    ign: claim.ign,
    accountIds: await getAccountMemberIds(supabase, [claim.member_id as string]),
  };
}

export interface GivenKudos {
  id: string;
  recipient_member_id: string;
  recipient_ign: string;
  reason: string;
  created_at: string;
}

async function givenThisWeek(supabase: SupabaseClient, userId: string, week = weekStartOf()): Promise<GivenKudos[]> {
  const { data } = await supabase
    .from('kudos')
    .select('id, recipient_member_id, reason, created_at, member:members!kudos_recipient_member_id_fkey(ign)')
    .eq('giver_user_id', userId)
    .eq('week_start', week)
    .order('created_at');
  return (data ?? []).map((k) => {
    const m = k.member as unknown as { ign?: string } | { ign?: string }[] | null;
    return {
      id: k.id as string,
      recipient_member_id: k.recipient_member_id as string,
      recipient_ign: (Array.isArray(m) ? m[0]?.ign : m?.ign) ?? '?',
      reason: k.reason as string,
      created_at: k.created_at as string,
    };
  });
}

export interface GiverStatus {
  /** False: no approved claim, cannot give. */
  can_give: boolean;
  remaining: number;
  per_week: number;
  given: GivenKudos[];
  /** Next reset (Monday 00:00 UTC), ISO. */
  resets_at: string;
}

export async function giverStatus(supabase: SupabaseClient, userId: string): Promise<GiverStatus> {
  const week = weekStartOf();
  const claim = await getActiveClaim(userId, supabase);
  const can = claim?.status === 'approved';
  const given = can ? await givenThisWeek(supabase, userId, week) : [];
  return {
    can_give: can,
    remaining: can ? Math.max(0, KUDOS_PER_WEEK - given.length) : 0,
    per_week: KUDOS_PER_WEEK,
    given,
    resets_at: `${addDays(week, 7)}T00:00:00.000Z`,
  };
}

// ─── Give ────────────────────────────────────────────────────────────────────

/** Character id for an IGN (case-insensitive, prefers active characters). */
export async function memberIdByIgn(supabase: SupabaseClient, ign: string): Promise<{ id: string; ign: string } | null> {
  const name = ign.trim();
  if (!name || name.length > 40) return null;
  const { data } = await supabase
    .from('members')
    .select('id, ign, is_active')
    .ilike('ign', escapeLike(name))
    .order('is_active', { ascending: false })
    .limit(1);
  return data?.[0] ? { id: data[0].id as string, ign: data[0].ign as string } : null;
}

export type GiveResult =
  | { ok: true; kudos: GivenKudos; giver_ign: string; recipient_ign: string; recipient_discord_id: string | null; remaining: number }
  | { ok: false; error: string };

export async function giveKudos(
  supabase: SupabaseClient,
  input: { giverUserId: string; recipientMemberId: string; reason: string; source: 'web' | 'discord' }
): Promise<GiveResult> {
  const reason = cleanReason(input.reason);
  if (reason.length < REASON_MIN) return { ok: false, error: `Say why, at least ${REASON_MIN} characters.` };
  if (reason.length > REASON_MAX) return { ok: false, error: `Keep the reason under ${REASON_MAX} characters.` };

  const giver = await loadGiver(supabase, input.giverUserId);
  if (!giver) return { ok: false, error: 'Claim your character first (`/claim` or the website) to give kudos.' };

  const { data: target } = await supabase.from('members').select('id, ign, discord_id').eq('id', input.recipientMemberId).maybeSingle();
  if (!target) return { ok: false, error: 'No Dream character found.' };
  const recipientIds = await getAccountMemberIds(supabase, [target.id as string]);
  if (Array.from(recipientIds).some((id) => giver.accountIds.has(id))) {
    return { ok: false, error: "That's your own account. Kudos are for thanking someone else." };
  }

  const week = weekStartOf();
  const given = await givenThisWeek(supabase, giver.userId, week);
  if (given.length >= KUDOS_PER_WEEK) {
    return { ok: false, error: `You've given all ${KUDOS_PER_WEEK} kudos this week. New ones on Monday (00:00 UTC).` };
  }
  const already = given.find((k) => recipientIds.has(k.recipient_member_id));
  if (already) return { ok: false, error: `You already gave **${already.recipient_ign}** kudos this week. One per person per week.` };

  const { data: row, error } = await supabase
    .from('kudos')
    .insert({
      giver_user_id: giver.userId,
      giver_member_id: giver.memberId,
      recipient_member_id: target.id,
      reason,
      week_start: week,
      source: input.source,
    })
    .select('id, created_at')
    .single();
  if (error || !row) return { ok: false, error: `Saving failed: ${error?.message ?? 'unknown error'}` };

  // Discord id of the recipient account, for a ping on Discord.
  let discordId = (target.discord_id as string | null) ?? null;
  if (!discordId) {
    const { data: ids } = await supabase.from('members').select('discord_id').in('id', Array.from(recipientIds)).not('discord_id', 'is', null).limit(1);
    discordId = (ids?.[0]?.discord_id as string | undefined) ?? null;
  }

  return {
    ok: true,
    kudos: { id: row.id as string, recipient_member_id: target.id as string, recipient_ign: target.ign as string, reason, created_at: row.created_at as string },
    giver_ign: giver.ign,
    recipient_ign: target.ign as string,
    recipient_discord_id: discordId,
    remaining: KUDOS_PER_WEEK - given.length - 1,
  };
}

// ─── Received ────────────────────────────────────────────────────────────────

export interface ReceivedKudos {
  total: number;
  this_week: number;
  givers: number;
  recent: { from_ign: string; to_ign: string; reason: string; at: string }[];
}

/** Kudos received by an account (pass the whole bundle's member ids). */
export async function receivedKudos(supabase: SupabaseClient, memberIds: string[], limit = 10): Promise<ReceivedKudos> {
  if (!memberIds.length) return { total: 0, this_week: 0, givers: 0, recent: [] };
  const { data } = await supabase
    .from('kudos')
    .select('giver_user_id, reason, created_at, week_start, giver:members!kudos_giver_member_id_fkey(ign), recipient:members!kudos_recipient_member_id_fkey(ign)')
    .in('recipient_member_id', memberIds)
    .order('created_at', { ascending: false });
  const rows = data ?? [];
  const week = weekStartOf();
  const ignOf = (v: unknown) => {
    const m = v as { ign?: string } | { ign?: string }[] | null;
    return (Array.isArray(m) ? m[0]?.ign : m?.ign) ?? 'Someone';
  };
  return {
    total: rows.length,
    this_week: rows.filter((r) => r.week_start === week).length,
    givers: new Set(rows.map((r) => r.giver_user_id)).size,
    recent: rows.slice(0, limit).map((r) => ({ from_ign: ignOf(r.giver), to_ign: ignOf(r.recipient), reason: r.reason as string, at: r.created_at as string })),
  };
}

// ─── Weekly shoutout ─────────────────────────────────────────────────────────

/** Markdown-safe, mention-safe text for Discord. */
export function discordSafe(s: string): string {
  return cleanReason(s)
    .replace(/([\\*_~`|>#\[\]])/g, '\\$1')
    .replace(/@/g, '@\u200b')
    .replace(/</g, '<\u200b');
}

const MEDALS = ['🥇', '🥈', '🥉'];

/** Shoutout for one week (week_start = Monday). Null when nobody gave kudos that week. */
export async function buildWeeklyShoutout(supabase: SupabaseClient, weekStart: string): Promise<LivePayload[] | null> {
  const { data } = await supabase
    .from('kudos')
    .select('giver_user_id, recipient_member_id, reason, created_at, giver:members!kudos_giver_member_id_fkey(ign)')
    .eq('week_start', weekStart)
    .order('created_at');
  const rows = data ?? [];
  if (!rows.length) return null;

  const recipientIds = Array.from(new Set(rows.map((r) => r.recipient_member_id as string)));
  const [accountOf, { data: members }] = await Promise.all([
    getAccountKeys(supabase, recipientIds),
    supabase.from('members').select('id, ign, discord_id').in('id', recipientIds),
  ]);
  const info = new Map((members ?? []).map((m) => [m.id as string, { ign: m.ign as string, discord: m.discord_id as string | null }]));
  const giverIgn = (v: unknown) => {
    const m = v as { ign?: string } | { ign?: string }[] | null;
    return (Array.isArray(m) ? m[0]?.ign : m?.ign) ?? 'Someone';
  };

  type Entry = { igns: Map<string, number>; discord: string | null; notes: { from: string; reason: string }[] };
  const byAccount = new Map<string, Entry>();
  for (const r of rows) {
    const mid = r.recipient_member_id as string;
    const key = accountOf.get(mid) ?? mid;
    const e: Entry = byAccount.get(key) ?? { igns: new Map(), discord: null, notes: [] };
    const who = info.get(mid);
    if (who) e.igns.set(who.ign, (e.igns.get(who.ign) ?? 0) + 1);
    e.discord ??= who?.discord ?? null;
    e.notes.push({ from: giverIgn(r.giver), reason: r.reason as string });
    byAccount.set(key, e);
  }
  const entries = Array.from(byAccount.values())
    .map((e) => ({ ...e, ign: Array.from(e.igns).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '?' }))
    .sort((a, b) => b.notes.length - a.notes.length || a.ign.localeCompare(b.ign));

  const name = (e: (typeof entries)[number]) => `**${discordSafe(e.ign)}**${e.discord ? ` (<@${e.discord}>)` : ''}`;
  const start = Math.floor(Date.parse(weekStart) / 1000);
  const end = start + 6 * 86_400;
  const givers = new Set(rows.map((r) => r.giver_user_id)).size;
  const lines = [
    `# 💎 Kudos of the week · <t:${start}:d> – <t:${end}:d>`,
    `**${rows.length}** kudos from **${givers}** member${givers === 1 ? '' : 's'} to **${entries.length}**. Thank you for looking out for each other.`,
  ];

  // Top 3 places (ties share a place), up to 2 reasons each.
  const top: typeof entries = [];
  let place = 0;
  for (let i = 0; i < entries.length && place < 3; i++) {
    if (i === 0 || entries[i].notes.length < entries[i - 1].notes.length) place = top.length + 1;
    if (place > 3 || entries[i].notes.length < 2) break; // a single kudos is not a podium
    top.push(entries[i]);
    if (top.length === 1) lines.push('', '### 🏆 Most appreciated');
    lines.push(`${MEDALS[place - 1] ?? `**${place}.**`} ${name(entries[i])} · ${entries[i].notes.length} kudos`);
    for (const n of entries[i].notes.slice(0, 2)) lines.push(`> “${discordSafe(n.reason)}” · ${discordSafe(n.from)}`);
  }

  const rest = entries.filter((e) => !top.includes(e));
  if (rest.length) {
    lines.push('', top.length ? '### 💬 More thanks' : '### 💬 Thanks this week');
    for (const e of rest.slice(0, 25)) {
      for (const n of e.notes.slice(0, 2)) lines.push(`• ${name(e)} ← ${discordSafe(n.from)}: “${discordSafe(n.reason)}”`);
    }
    if (rest.length > 25) lines.push(`-# …and ${rest.length - 25} more.`);
  }
  lines.push('', `-# Give kudos with \`/kudos give\` or the 💎 button on any profile (${GUIDE_SITE_URL.replace(/^https?:\/\//, '')}/p/…) · ${KUDOS_PER_WEEK} per week.`);
  return textPayloads(lines);
}

/** Last completed week (Monday). */
export const lastWeekStart = (now = new Date()) => addDays(weekStartOf(now), -7);

/**
 * Daily cron: post last week's shoutout once. "Already posted" = the live row was published
 * since this Monday (cron or a manual Update now). Unbound/paused key or empty week = nothing.
 */
export async function postDueKudosShoutout(supabase: SupabaseClient): Promise<PublishResult | 'unbound' | 'posted' | 'empty'> {
  const row = await getLiveRow(supabase, KUDOS_WEEKLY_KEY);
  if (!row || !row.enabled) return 'unbound';
  const thisWeek = weekStartOf();
  if (row.last_published_at && row.last_published_at.slice(0, 10) >= thisWeek) return 'posted';
  const payloads = await buildWeeklyShoutout(supabase, lastWeekStart());
  if (!payloads) return 'empty';
  return publishLive(supabase, KUDOS_WEEKLY_KEY, payloads, { mode: 'append' });
}
