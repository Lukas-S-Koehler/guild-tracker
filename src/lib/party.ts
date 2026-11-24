/**
 * League party finder (Dream Hub step 16, spec docs/party-finder.md).
 * Data, the league-list paste parser, the 📋 Party board (live key `party-board`, a pinned post in
 * the #league-party-find forum) and the party card (starter / pinned message in each party thread).
 * Everything is keyed by Discord user id: no website account needed.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { createForumPost, editChannelMessageRich, patchThread, pinChannelMessage, postToChannelRich } from '@/lib/discord-api';
import { getLiveRow, publishLive, textPayloads, type LivePayload, type PublishResult } from '@/lib/discord-live';

export const PARTY_FORUM_ID = '1444751519588024492';
export const PARTY_BOARD_KEY = 'party-board';
/** Discord role allowed to import leagues, attach threads, verify parties ("supreme staff"). */
export const PARTY_STAFF_ROLE_ID = '1445371753181220904';
export const PARTY_MAX = 4;
export const SEEKER_DAYS = 14;

export const isPartyStaff = (roles: string[] | undefined) => !!roles?.includes(PARTY_STAFF_ROLE_ID);

/** League targets in game, plus the party Slayer pseudo-skill for /lfg. */
export const LEAGUE_SKILLS = [
  'Woodcutting', 'Mining', 'Fishing', 'Alchemy', 'Smelting', 'Cooking', 'Forge', 'Construction', 'Meditation',
  'Hunting Mastery', 'Pet Mastery', 'Village Mastery', 'Springtide Mastery', 'Lunar Mastery', 'Shadow Mastery',
  'Yule Mastery', 'Battle',
] as const;
export const SLAYER_SKILL = 'Party Slayer';

export const RESTRICTIONS = ['cursed', 'restricted', 'forsaken', 'banished'] as const;
export type Restriction = (typeof RESTRICTIONS)[number];

export interface League {
  id: string;
  skill: string;
  contribution: 'exp' | 'kills';
  max_size: number;
  starts_on: string; // YYYY-MM-DD
  ends_on: string;
  restriction: Restriction | null;
  entrants: number | null;
}

export interface Party {
  id: string;
  name: string;
  thread_id: string | null;
  card_message_id: string | null;
  leader_discord_id: string;
  verified: boolean;
  slayer: boolean;
  note: string | null;
  created_at: string;
  closed_at: string | null;
}

export interface PartyMember { party_id: string; discord_id: string; rank: 'leader' | 'officer' | 'member' }
export interface PartyLeague { party_id: string; league_id: string; status: 'planning' | 'joined' }
export interface Seeker { discord_id: string; skills: string[]; note: string | null; expires_at: string }

export interface PartyFull extends Party {
  members: PartyMember[];
  leagues: Array<PartyLeague & { league: League }>;
}

// ─── Dates ───────────────────────────────────────────────────────────────────

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
export const todayUtc = () => new Date().toISOString().slice(0, 10);
const iso = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const unix = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000);
const shortDate = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`);
  return `${d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })} ${d.getUTCDate()}`;
};

export function leagueState(l: Pick<League, 'starts_on' | 'ends_on'>, today = todayUtc()): 'upcoming' | 'active' | 'ended' {
  if (today < l.starts_on) return 'upcoming';
  if (today <= l.ends_on) return 'active';
  return 'ended';
}

const days = (l: League) => Math.round((unix(l.ends_on) - unix(l.starts_on)) / 86400);
const lengthLabel = (l: League) => {
  const d = days(l);
  return d % 7 === 0 ? `${d / 7} wk` : `${d} d`;
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "Alchemy · Nov 25 – Dec 23 · 🔒 Cursed" (kills / EXP only spelled out for Battle). */
export function leagueLabel(l: League, opts: { dates?: boolean } = {}): string {
  const parts = [l.skill === 'Battle' ? `Battle (${l.contribution === 'kills' ? 'kills' : 'EXP'})` : l.skill + (l.contribution === 'kills' ? ' (kills)' : '')];
  if (opts.dates !== false) parts.push(`${shortDate(l.starts_on)} – ${shortDate(l.ends_on)}`);
  if (l.restriction) parts.push(`🔒 ${cap(l.restriction)}`);
  return parts.join(' · ');
}

// ─── Paste parser ────────────────────────────────────────────────────────────

export interface ParsedLeague {
  skill: string;
  contribution: 'exp' | 'kills';
  max_size: number;
  starts_on: string;
  ends_on: string;
  entrants: number | null;
  restriction: Restriction | null;
}

const ROW = /^(experience|kills)\s+(\d+)\s+([a-z]{3})[a-z]*\.?\s+(\d{1,2})\s*[-–]\s*([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:\s+[a-z]+)?(?:\s+(\d+))?/i;
const IGNORE = /^(target skill|contribution type|status|league|size|dates?|entrants?|participants?)$/i;

function canonicalSkill(raw: string): string {
  const s = raw.trim().replace(/\s+/g, ' ');
  return LEAGUE_SKILLS.find((k) => k.toLowerCase() === s.toLowerCase()) ?? s;
}

/** Year for a month/day closest to `ref` (lists only show upcoming/active leagues). */
function nearestDate(month: number, day: number, ref: Date): string {
  const y = ref.getUTCFullYear();
  const best = [y - 1, y, y + 1]
    .map((yy) => ({ yy, diff: Math.abs(Date.UTC(yy, month, day) - ref.getTime()) }))
    .sort((a, b) => a.diff - b.diff)[0]!;
  return iso(best.yy, month, day);
}

/**
 * Parse the in-game league list as copied from the browser: the skill name (usually twice), then
 * "Experience    4    Nov 25 - Dec 23    Upcoming    15". A restriction word between rows
 * (Cursed, Restricted, Forsaken, Banished) is picked up when the copy contains it.
 */
export function parseLeagueList(text: string, ref = new Date()): { leagues: ParsedLeague[]; skipped: string[] } {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\t/g, '    ').trim()).filter(Boolean);
  const leagues: ParsedLeague[] = [];
  const skipped: string[] = [];
  let since: string[] = []; // lines since the last row
  for (const line of lines) {
    const m = ROW.exec(line);
    if (!m) {
      if (!IGNORE.test(line)) since.push(line);
      continue;
    }
    const sm = MONTHS.indexOf(m[3]!.toLowerCase());
    const em = MONTHS.indexOf(m[5]!.toLowerCase());
    const names = since.filter((l) => !RESTRICTIONS.some((r) => r === l.toLowerCase()));
    const skillRaw = names[names.length - 1];
    if (sm < 0 || em < 0 || !skillRaw) {
      skipped.push(line);
      since = [];
      continue;
    }
    const starts_on = nearestDate(sm, Number(m[4]), ref);
    const sy = Number(starts_on.slice(0, 4));
    const ends_on = iso(em < sm ? sy + 1 : sy, em, Number(m[6]));
    const restrictionWord = since.join(' ').toLowerCase().match(/\b(cursed|restricted|forsaken|banished)\b/)?.[1] as Restriction | undefined;
    leagues.push({
      skill: canonicalSkill(skillRaw),
      contribution: m[1]!.toLowerCase() === 'kills' ? 'kills' : 'exp',
      max_size: Number(m[2]) || PARTY_MAX,
      starts_on,
      ends_on,
      entrants: m[7] ? Number(m[7]) : null,
      restriction: restrictionWord ?? null,
    });
    since = [];
  }
  return { leagues, skipped };
}

const leagueKey = (l: Pick<League, 'skill' | 'contribution' | 'starts_on' | 'ends_on'>) => `${l.skill}|${l.contribution}|${l.starts_on}|${l.ends_on}`;

/**
 * Save a parsed list. Rows already known (same skill, type and dates) are updated, so pasting the
 * list again is safe. Two leagues can share skill + dates (e.g. a normal and a cursed one): they
 * are matched by closest entrant count and keep the restriction staff set.
 */
export async function importLeagues(supabase: SupabaseClient, parsed: ParsedLeague[]) {
  const { data, error } = await supabase.from('leagues').select('*').gte('ends_on', iso(new Date().getUTCFullYear() - 1, 0, 1));
  if (error) throw new Error(error.message);
  const pool = new Map<string, League[]>();
  for (const l of (data ?? []) as League[]) pool.set(leagueKey(l), [...(pool.get(leagueKey(l)) ?? []), l]);

  const added: League[] = [];
  const updated: League[] = [];
  for (const p of parsed) {
    const candidates = pool.get(leagueKey(p)) ?? [];
    let match: League | undefined;
    if (candidates.length) {
      candidates.sort((a, b) => Math.abs((a.entrants ?? 0) - (p.entrants ?? 0)) - Math.abs((b.entrants ?? 0) - (p.entrants ?? 0)));
      match = candidates.shift();
    }
    if (match) {
      const patch = { entrants: p.entrants, max_size: p.max_size, updated_at: new Date().toISOString(), ...(p.restriction ? { restriction: p.restriction } : {}) };
      const { error: e } = await supabase.from('leagues').update(patch).eq('id', match.id);
      if (e) throw new Error(e.message);
      updated.push({ ...match, ...patch } as League);
    } else {
      const { data: row, error: e } = await supabase.from('leagues').insert(p).select('*').single();
      if (e) throw new Error(e.message);
      added.push(row as League);
    }
  }
  return { added, updated };
}

/** Leagues whose entrant count is far below the rest: likely class-restricted, worth a check. */
export function maybeRestricted(leagues: Array<Pick<League, 'entrants' | 'restriction'> & { id?: string }>) {
  const counts = leagues.map((l) => l.entrants ?? 0).filter((n) => n > 0).sort((a, b) => a - b);
  if (counts.length < 4) return new Set<number>();
  const median = counts[Math.floor(counts.length / 2)]!;
  return new Set(leagues.map((l, i) => (!l.restriction && l.entrants != null && l.entrants < median * 0.4 ? i : -1)).filter((i) => i >= 0));
}

// ─── Reads ───────────────────────────────────────────────────────────────────

export async function listLiveLeagues(supabase: SupabaseClient): Promise<League[]> {
  const { data, error } = await supabase.from('leagues').select('*').gte('ends_on', todayUtc()).order('starts_on').order('skill');
  if (error) throw new Error(error.message);
  return (data ?? []) as League[];
}

export async function getLeague(supabase: SupabaseClient, id: string): Promise<League | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await supabase.from('leagues').select('*').eq('id', id).maybeSingle();
  return (data as League | null) ?? null;
}

export async function loadParties(supabase: SupabaseClient, filter: { ids?: string[]; open?: boolean } = { open: true }): Promise<PartyFull[]> {
  let q = supabase.from('parties').select('*').order('created_at');
  if (filter.ids) q = q.in('id', filter.ids);
  if (filter.open) q = q.is('closed_at', null);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const parties = (data ?? []) as Party[];
  if (!parties.length) return [];
  const ids = parties.map((p) => p.id);
  const [mem, pl] = await Promise.all([
    supabase.from('party_members').select('party_id, discord_id, rank, joined_at').in('party_id', ids).order('joined_at'),
    supabase.from('party_leagues').select('party_id, league_id, status').in('party_id', ids),
  ]);
  const leagueIds = Array.from(new Set((pl.data ?? []).map((r) => r.league_id as string)));
  const { data: leagues } = leagueIds.length ? await supabase.from('leagues').select('*').in('id', leagueIds) : { data: [] };
  const byId = new Map(((leagues ?? []) as League[]).map((l) => [l.id, l]));
  const rankOrder = { leader: 0, officer: 1, member: 2 };
  return parties.map((p) => ({
    ...p,
    members: ((mem.data ?? []) as PartyMember[]).filter((m) => m.party_id === p.id).sort((a, b) => rankOrder[a.rank] - rankOrder[b.rank]),
    leagues: ((pl.data ?? []) as PartyLeague[])
      .filter((r) => r.party_id === p.id && byId.has(r.league_id))
      .map((r) => ({ ...r, league: byId.get(r.league_id)! }))
      .sort((a, b) => a.league.starts_on.localeCompare(b.league.starts_on)),
  }));
}

export async function getParty(supabase: SupabaseClient, id: string): Promise<PartyFull | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return (await loadParties(supabase, { ids: [id] }))[0] ?? null;
}

export async function partyByThread(supabase: SupabaseClient, threadId: string): Promise<PartyFull | null> {
  const { data } = await supabase.from('parties').select('id').eq('thread_id', threadId).is('closed_at', null).maybeSingle();
  return data ? getParty(supabase, data.id as string) : null;
}

export async function partiesOf(supabase: SupabaseClient, discordId: string): Promise<PartyFull[]> {
  const { data } = await supabase.from('party_members').select('party_id').eq('discord_id', discordId);
  const ids = (data ?? []).map((r) => r.party_id as string);
  return ids.length ? loadParties(supabase, { ids, open: true }) : [];
}

export async function activeSeekers(supabase: SupabaseClient): Promise<Seeker[]> {
  const { data } = await supabase.from('party_seekers').select('*').gt('expires_at', new Date().toISOString()).order('updated_at', { ascending: false });
  return (data ?? []) as Seeker[];
}

/** CL + guild tag per Discord user, from their mapped characters (nothing if unmapped). */
export async function discordInfo(supabase: SupabaseClient, discordIds: string[]): Promise<Map<string, { cl: number | null; tags: string[] }>> {
  const out = new Map<string, { cl: number | null; tags: string[] }>();
  if (!discordIds.length) return out;
  const [{ data: chars }, { data: guilds }] = await Promise.all([
    supabase.from('members').select('discord_id, combat_level, current_guild_id').in('discord_id', discordIds).eq('is_active', true),
    supabase.from('guilds').select('id, nickname'),
  ]);
  const tag = new Map((guilds ?? []).map((g) => [g.id as string, g.nickname as string]));
  for (const c of chars ?? []) {
    const cur = out.get(c.discord_id as string) ?? { cl: null, tags: [] };
    if (c.combat_level != null) cur.cl = Math.max(cur.cl ?? 0, c.combat_level as number);
    const t = c.current_guild_id ? tag.get(c.current_guild_id as string) : null;
    if (t && !cur.tags.includes(t)) cur.tags.push(t);
    out.set(c.discord_id as string, cur);
  }
  return out;
}

// ─── Party card (in the party's own thread) ──────────────────────────────────

export const openSlots = (p: PartyFull, l?: League) => Math.max(0, (l?.max_size ?? PARTY_MAX) - p.members.length);
export const ASK_PREFIX = 'party:ask:';

export function partyCardPayload(p: PartyFull): LivePayload {
  const today = todayUtc();
  const by = (r: PartyMember['rank']) => p.members.filter((m) => m.rank === r).map((m) => `<@${m.discord_id}>`);
  const officers = by('officer');
  const members = by('member');
  const leagues = p.leagues.filter((x) => leagueState(x.league, today) !== 'ended');
  const lines = [
    `## ${p.closed_at ? '🔒' : '🎉'} ${p.name}${p.verified ? ' · 💤 Dream party' : ''}${p.closed_at ? ' (closed)' : ''}`,
    [`👑 ${by('leader').join(' ') || `<@${p.leader_discord_id}>`}`, officers.length && `⭐ ${officers.join(' ')}`, members.length && `👤 ${members.join(' ')}`].filter(Boolean).join(' · '),
    `**Members:** ${p.members.length}/${PARTY_MAX}${p.members.length < PARTY_MAX ? ` · ${PARTY_MAX - p.members.length} open` : ' · full'}`,
    '',
    '**Leagues**',
    ...(leagues.length
      ? leagues.map((x) => `• ${leagueLabel(x.league)} · ${x.status === 'joined' ? '✅ joined' : `planning${openSlots(p, x.league) ? ` · ${openSlots(p, x.league)} open` : ''}`}`)
      : ['• none yet: `/party league`']),
    ...(p.slayer ? ['', '🗡️ **Open for party Slayer**'] : []),
    ...(p.note ? ['', `📝 ${p.note}`] : []),
    '',
    '-# Leader/officers: `/party invite` · `/party league` · `/party edit`. Looking to join? Press 🙋 below. All parties: 📋 Party board.',
  ];
  const canAsk = p.members.length < PARTY_MAX && !p.closed_at;
  return {
    content: lines.join('\n').slice(0, 1990),
    allowed_mentions: { parse: [] },
    components: canAsk ? [{ type: 1, components: [{ type: 2, style: 1, label: 'Ask to join', emoji: { name: '🙋' }, custom_id: `${ASK_PREFIX}${p.id}` }] }] : [],
  };
}

/** Thread posts can't be edited while archived: unarchive and retry once. */
async function editInThread(threadId: string, messageId: string, payload: Record<string, unknown>) {
  let r = await editChannelMessageRich(threadId, messageId, payload);
  if (!r.ok && /50083|archived/i.test(r.error ?? '')) {
    await patchThread(threadId, { archived: false });
    r = await editChannelMessageRich(threadId, messageId, payload);
  }
  return r;
}

/** Create or update the party card. New parties without a thread get a new forum post. */
export async function syncPartyCard(supabase: SupabaseClient, p: PartyFull): Promise<{ ok: boolean; error?: string }> {
  const payload = partyCardPayload(p) as Record<string, unknown>;
  if (!p.thread_id) {
    const r = await createForumPost(PARTY_FORUM_ID, p.name, payload);
    if (!r.ok || !r.threadId) return { ok: false, error: r.error };
    await supabase.from('parties').update({ thread_id: r.threadId, card_message_id: r.threadId }).eq('id', p.id);
    p.thread_id = r.threadId;
    p.card_message_id = r.threadId;
    return { ok: true };
  }
  if (p.card_message_id) {
    const r = await editInThread(p.thread_id, p.card_message_id, payload);
    if (r.ok) return r;
    if (!/ 404\b/.test(r.error ?? '')) return r;
  }
  // No card yet (adopted thread) or it was deleted: post + pin a fresh one.
  await patchThread(p.thread_id, { archived: false });
  const posted = await postToChannelRich(p.thread_id, payload);
  if (!posted.ok || !posted.messageId) return { ok: false, error: posted.error };
  await pinChannelMessage(p.thread_id, posted.messageId);
  await supabase.from('parties').update({ card_message_id: posted.messageId }).eq('id', p.id);
  p.card_message_id = posted.messageId;
  return { ok: true };
}

// ─── 📋 Party board (live key party-board) ───────────────────────────────────

const threadRef = (p: Party) => (p.thread_id ? `<#${p.thread_id}>` : `**${p.name}**`);
const badge = (p: Party) => (p.verified ? '💤 ' : '');

export async function buildPartyBoard(supabase: SupabaseClient): Promise<LivePayload[]> {
  const today = todayUtc();
  const [leagues, parties, seekers] = await Promise.all([listLiveLeagues(supabase), loadParties(supabase), activeSeekers(supabase)]);
  const info = await discordInfo(supabase, seekers.map((s) => s.discord_id));
  const inLeague = (l: League) => parties.filter((p) => p.leagues.some((x) => x.league_id === l.id));

  const lines = [
    '# 📋 Dream party board',
    'Parties for leagues and party Slayer. List yours with `/party create`, look for one with `/lfg set`, upcoming leagues: `/league list`.',
    `-# 💤 = verified Dream party · open slots only count before a party joins the league in game (joined parties are locked) · updated <t:${Math.floor(Date.now() / 1000)}:R>`,
  ];

  const upcoming = leagues.filter((l) => leagueState(l, today) === 'upcoming');
  lines.push('', '## ⏳ Upcoming leagues');
  if (!upcoming.length) lines.push('-# No upcoming leagues imported yet.');
  for (const l of upcoming) {
    lines.push(`**${leagueLabel(l)}** · ${lengthLabel(l)} · starts <t:${unix(l.starts_on)}:R>`);
    for (const p of inLeague(l)) {
      const st = p.leagues.find((x) => x.league_id === l.id)!.status;
      const open = openSlots(p, l);
      lines.push(`└ ${badge(p)}${threadRef(p)} · ${p.members.length}/${l.max_size} · ${st === 'joined' ? '✅ joined' : open ? `**${open} open**` : 'full'}`);
    }
  }

  const active = leagues.filter((l) => leagueState(l, today) === 'active');
  const activeWith = active.filter((l) => inLeague(l).length);
  lines.push('', '## 🔥 Running now');
  if (!active.length) lines.push('-# No league running.');
  for (const l of activeWith) {
    lines.push(`**${leagueLabel(l, { dates: false })}** · ends <t:${unix(l.ends_on) + 86400}:R>`);
    lines.push(`└ ${inLeague(l).map((p) => `${badge(p)}${threadRef(p)}`).join(' · ')}`);
  }
  const quiet = active.filter((l) => !inLeague(l).length);
  if (quiet.length) lines.push(`-# Also running: ${quiet.map((l) => leagueLabel(l, { dates: false })).join(', ')}`);

  const slayer = parties.filter((p) => p.slayer && p.members.length < PARTY_MAX);
  lines.push('', '## 🗡️ Party Slayer: parties with room');
  lines.push(...(slayer.length ? slayer.map((p) => `${badge(p)}${threadRef(p)} · ${p.members.length}/${PARTY_MAX}${p.note ? ` · ${p.note}` : ''}`) : ['-# None right now. Leaders: `/party edit slayer:open`.']));

  lines.push('', '## 🙋 Looking for a party');
  if (!seekers.length) lines.push('-# Nobody listed. `/lfg set` to list yourself for 14 days.');
  for (const s of seekers) {
    const i = info.get(s.discord_id);
    const who = [`<@${s.discord_id}>`, i?.cl ? `CL ${i.cl}` : null, i?.tags.length ? i.tags.join('/') : null].filter(Boolean).join(' · ');
    lines.push(`${who} · ${s.skills.length ? s.skills.join(', ') : 'anything'}${s.note ? ` · “${s.note}”` : ''}`);
  }

  const others = parties.filter((p) => !p.leagues.some((x) => leagueState(x.league, today) !== 'ended') && !p.slayer);
  if (others.length) {
    lines.push('', '## 🎉 Other parties', others.map((p) => `${badge(p)}${threadRef(p)} ${p.members.length}/${PARTY_MAX}`).join(' · '));
  }

  // Edits fail on an archived thread; the board post is quiet, so wake it up before publishing.
  const row = await getLiveRow(supabase, PARTY_BOARD_KEY);
  if (row) await patchThread(row.channel_id, { archived: false });
  return textPayloads(lines);
}

/** Rebuild the board now (after any party / league / lfg change). Unbound = nothing. */
export async function refreshPartyBoard(supabase: SupabaseClient): Promise<PublishResult> {
  const row = await getLiveRow(supabase, PARTY_BOARD_KEY);
  if (!row) return { ok: false, status: 'unbound', message_ids: [] };
  return publishLive(supabase, PARTY_BOARD_KEY, await buildPartyBoard(supabase), { mode: 'edit' });
}
