/**
 * Recruit tracker: shared list of players staff have messaged (or ruled out) while recruiting
 * for assaults. One row per player across all Dream guilds. Joins are detected from the
 * member sync: once a prospect's name shows up active in a Dream guild, they're "joined".
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  RECHECK_DAYS, isForward,
  type InboxEntry, type NearbyChar, type RecruitLanguage, type RecruitStatus,
} from '@/lib/recruit-parse';

export interface Prospect {
  id: string;
  ign: string;
  status: RecruitStatus;
  location: string | null;
  language: RecruitLanguage | null;
  note: string | null;
  messaged_at: string | null;
  replied_at: string | null;
  joined_at: string | null;
  joined_guild_id: string | null;
  recheck_after: string | null;
  messaged_by_name: string | null;
  updated_by_name: string | null;
  updated_at: string;
}

export interface Actor { id: string; name: string | null }

const COLS =
  'id, ign, status, location, language, note, messaged_at, replied_at, joined_at, joined_guild_id, recheck_after, messaged_by_name, updated_by_name, updated_at';
const DAY_MS = 86_400_000;
const key = (ign: string) => ign.toLowerCase();

/** Display name for a staff user: their claimed character, preferring one in `guildId`. */
export async function staffName(supabase: SupabaseClient, userId: string, guildId: string): Promise<string | null> {
  const { data } = await supabase
    .from('user_characters')
    .select('members(ign, current_guild_id)')
    .eq('user_id', userId)
    .eq('status', 'approved');
  const chars = (data ?? [])
    .map((r: any) => (Array.isArray(r.members) ? r.members[0] : r.members))
    .filter(Boolean) as { ign: string; current_guild_id: string | null }[];
  return (chars.find((c) => c.current_guild_id === guildId) ?? chars[0])?.ign ?? null;
}

/** Active Dream-guild members among `igns`, keyed by lowercase ign → guild id. */
async function dreamMembers(supabase: SupabaseClient, igns: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < igns.length; i += 200) {
    const { data } = await supabase
      .from('members')
      .select('ign, current_guild_id')
      .in('ign', igns.slice(i, i + 200))
      .eq('is_active', true)
      .not('current_guild_id', 'is', null);
    for (const m of data ?? []) out.set(key(m.ign), m.current_guild_id as string);
  }
  return out;
}

async function allProspects(supabase: SupabaseClient): Promise<Prospect[]> {
  const { data, error } = await supabase.from('recruit_prospects').select(COLS).order('updated_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Prospect[];
}

/** Marks prospects that now show up in a Dream guild as joined. Returns how many changed. */
export async function detectJoins(supabase: SupabaseClient): Promise<number> {
  const open = (await allProspects(supabase)).filter((p) => p.status !== 'joined');
  if (!open.length) return 0;
  const inDream = await dreamMembers(supabase, open.map((p) => p.ign));
  const now = new Date().toISOString();
  let n = 0;
  for (const p of open) {
    const guild = inDream.get(key(p.ign));
    if (!guild) continue;
    await supabase
      .from('recruit_prospects')
      .update({ status: 'joined', joined_at: now, joined_guild_id: guild, recheck_after: null, updated_at: now })
      .eq('id', p.id);
    n++;
  }
  return n;
}

export interface Funnel {
  messaged: number; replied: number; joined: number; declined: number; skipped: number;
  by_location: { location: string; messaged: number; joined: number }[];
}

function funnel(rows: Prospect[]): Funnel {
  const contacted = rows.filter((r) => r.messaged_at);
  const locs = new Map<string, { messaged: number; joined: number }>();
  for (const r of contacted) {
    const l = r.location ?? 'Unknown';
    const v = locs.get(l) ?? { messaged: 0, joined: 0 };
    v.messaged++;
    if (r.status === 'joined') v.joined++;
    locs.set(l, v);
  }
  return {
    messaged: contacted.length,
    replied: contacted.filter((r) => r.replied_at || r.status === 'joined' || r.status === 'declined').length,
    joined: rows.filter((r) => r.status === 'joined').length,
    declined: rows.filter((r) => r.status === 'declined').length,
    skipped: rows.filter((r) => r.status === 'skip_guild' || r.status === 'skip_weak').length,
    by_location: Array.from(locs, ([location, v]) => ({ location, ...v })).sort((a, b) => b.messaged - a.messaged),
  };
}

export async function listProspects(supabase: SupabaseClient): Promise<{ prospects: Prospect[]; funnel: Funnel }> {
  await detectJoins(supabase);
  const prospects = await allProspects(supabase);
  return { prospects, funnel: funnel(prospects) };
}

// ---------------------------------------------------------------------------
// Nearby triage
// ---------------------------------------------------------------------------

export type Bucket = 'check' | 'recheck' | 'done' | 'tagged' | 'dream';
export interface NearbyRow extends NearbyChar { bucket: Bucket; prospect: Prospect | null }

export async function classifyNearby(supabase: SupabaseClient, chars: NearbyChar[]): Promise<NearbyRow[]> {
  if (!chars.length) return [];
  const [prospects, inDream] = await Promise.all([
    allProspects(supabase),
    dreamMembers(supabase, chars.map((c) => c.ign)),
  ]);
  const byIgn = new Map(prospects.map((p) => [key(p.ign), p]));
  const now = Date.now();
  return chars.map((c) => {
    const p = byIgn.get(key(c.ign)) ?? null;
    let bucket: Bucket;
    if (inDream.has(key(c.ign))) bucket = 'dream';
    else if (c.tag) bucket = 'tagged';
    else if (!p) bucket = 'check';
    else if ((p.status === 'skip_guild' || p.status === 'skip_weak') && p.recheck_after && Date.parse(p.recheck_after) <= now)
      bucket = 'recheck';
    else bucket = 'done';
    return { ...c, bucket, prospect: p };
  });
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface SetStatusInput {
  ign: string;
  status: RecruitStatus;
  location?: string | null;
  language?: RecruitLanguage | null;
  note?: string | null;
}

/** Manual status change from the UI. Creates the prospect if new. */
export async function setStatus(supabase: SupabaseClient, input: SetStatusInput, actor: Actor): Promise<Prospect> {
  const ign = input.ign.trim();
  const { data: existing } = await supabase.from('recruit_prospects').select(COLS).ilike('ign', ign.replace(/[\\%_]/g, (c) => `\\${c}`)).maybeSingle();
  const now = new Date().toISOString();
  const days = RECHECK_DAYS[input.status];
  const patch: Record<string, unknown> = {
    ign: existing?.ign ?? ign,
    status: input.status,
    recheck_after: days ? new Date(Date.now() + days * DAY_MS).toISOString() : null,
    updated_by: actor.id,
    updated_by_name: actor.name,
    updated_at: now,
  };
  if (input.location !== undefined) patch.location = input.location || null;
  if (input.language !== undefined) patch.language = input.language;
  if (input.note !== undefined) patch.note = input.note || null;
  if (input.status === 'messaged' && !existing?.messaged_at) {
    patch.messaged_at = now;
    patch.messaged_by = actor.id;
    patch.messaged_by_name = actor.name;
  }
  if ((input.status === 'replied' || input.status === 'declined') && !existing?.replied_at) patch.replied_at = now;
  if (input.status === 'joined' && !existing?.joined_at) patch.joined_at = now;

  const q = existing
    ? supabase.from('recruit_prospects').update(patch).eq('id', existing.id)
    : supabase.from('recruit_prospects').insert(patch);
  const { data, error } = await q.select(COLS).single();
  if (error) throw new Error(error.message);
  return data as Prospect;
}

export async function updateNote(supabase: SupabaseClient, id: string, note: string | null, actor: Actor) {
  const { error } = await supabase
    .from('recruit_prospects')
    .update({ note: note || null, updated_by: actor.id, updated_by_name: actor.name, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteProspect(supabase: SupabaseClient, id: string) {
  const { error } = await supabase.from('recruit_prospects').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export interface ImportResult { added: number; advanced: number; unchanged: number; igns: string[] }

/**
 * Inbox import: a sent template → messaged, any other text in the conversation → replied.
 * Only ever moves a prospect forward (never undoes declined/joined or a manual skip after contact).
 */
export async function importInbox(supabase: SupabaseClient, entries: InboxEntry[], actor: Actor): Promise<ImportResult> {
  // Collapse per player: earliest sent, latest reply.
  const per = new Map<string, { ign: string; sent?: InboxEntry; reply?: InboxEntry }>();
  for (const e of entries) {
    const v = per.get(key(e.ign)) ?? { ign: e.ign };
    if (e.kind === 'sent' && (!v.sent || (e.at ?? '') < (v.sent.at ?? ''))) v.sent = e;
    if (e.kind === 'reply' && (!v.reply || (e.at ?? '') > (v.reply.at ?? ''))) v.reply = e;
    per.set(key(e.ign), v);
  }
  const existing = new Map((await allProspects(supabase)).map((p) => [key(p.ign), p]));
  const res: ImportResult = { added: 0, advanced: 0, unchanged: 0, igns: [] };
  const now = new Date().toISOString();

  for (const [k, v] of Array.from(per)) {
    const p = existing.get(k);
    const target: RecruitStatus = v.reply ? 'replied' : 'messaged';
    const sent = v.sent;
    const patch: Record<string, unknown> = { updated_by: actor.id, updated_by_name: actor.name, updated_at: now };
    if (!p?.messaged_at) {
      patch.messaged_at = sent?.at ?? v.reply?.at ?? now;
      patch.messaged_by = actor.id;
      patch.messaged_by_name = actor.name;
    }
    if (sent?.location && !p?.location) patch.location = sent.location;
    if (sent?.language && !p?.language) patch.language = sent.language;
    if (v.reply && !p?.replied_at) patch.replied_at = v.reply.at ?? now;

    if (!p) {
      const { error } = await supabase.from('recruit_prospects').insert({ ign: v.ign, status: target, ...patch });
      if (error) throw new Error(error.message);
      res.added++;
      res.igns.push(v.ign);
      continue;
    }
    // A skip set before we'd messaged them is overridden by contact; otherwise only move forward.
    const advance = isForward(p.status, target);
    if (advance) {
      patch.status = target;
      patch.recheck_after = null;
    }
    if (!advance && Object.keys(patch).length <= 3) { res.unchanged++; continue; }
    const { error } = await supabase.from('recruit_prospects').update(patch).eq('id', p.id);
    if (error) throw new Error(error.message);
    if (advance) { res.advanced++; res.igns.push(p.ign); } else res.unchanged++;
  }
  return res;
}
