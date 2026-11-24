/**
 * Discord chat reader (Dream Pass step 15): DreamBot's own Discord level system, no third-party bot.
 *
 * DreamBot has no gateway, so it reads channel history over REST: per member channel it keeps a cursor
 * (newest message id read) and asks for the messages after it. A missed run simply catches up on the
 * next one; re-reading is harmless because rows are keyed by message id. The very first run walks each
 * channel from its start (backfill), spread over several runs by a time budget.
 *
 * Stored per message: id, author, channel, time. No content. Length filter is applied while reading,
 * the 60 s cooldown when counting (`countedMessages`), so reading order never matters.
 *
 * Member channels = text channels a `Member - TAG` role (or @everyone) can see, minus the Bots category
 * and bot channels. Staff-only and other-game channels drop out on their own.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { listGuildChannels, listMessagesAfter, type DiscordChannel, type DiscordMessageLite } from '@/lib/discord-api';
import { DISCORD_SERVER_ID } from '@/lib/discord-live';
import { GUILD_ROLES } from '@/lib/discord-roles';
import { CHAT_DAY_MIN, CHAT_MIN_CHARS, countedMessages } from '@/lib/dream-pass';

const VIEW = BigInt(1) << BigInt(10);
const EXCLUDED_NAMES = new Set(['bot-commands', 'wb-pings', 'wb-status', 'bump']);
const MEMBER_ROLE_IDS = new Set(Object.values(GUILD_ROLES).map((g) => g.member));
const PAGE = 1000;

const norm = (s: string) => s.normalize('NFKC').toLowerCase();

export function isMemberChannel(c: DiscordChannel, categories: Map<string, string>): boolean {
  if (c.type !== 0) return false;
  if (EXCLUDED_NAMES.has(c.name)) return false;
  const cat = c.parent_id ? categories.get(c.parent_id) : undefined;
  if (cat && norm(cat).includes('bots')) return false;
  const ow = c.permission_overwrites ?? [];
  const everyone = ow.find((o) => o.id === DISCORD_SERVER_ID);
  if (!everyone || (BigInt(everyone.deny) & VIEW) === BigInt(0)) return true; // public channel
  return ow.some((o) => o.type === 0 && MEMBER_ROLE_IDS.has(o.id) && (BigInt(o.allow) & VIEW) !== BigInt(0));
}

export async function memberChannels(): Promise<DiscordChannel[]> {
  const all = await listGuildChannels(DISCORD_SERVER_ID);
  const categories = new Map(all.filter((c) => c.type === 4).map((c) => [c.id, c.name]));
  return all.filter((c) => isMemberChannel(c, categories));
}

/** Human, non-system message long enough to count (or carrying an attachment / sticker). */
export function qualifies(m: DiscordMessageLite): boolean {
  if (m.author?.bot || m.webhook_id) return false;
  if (m.type !== 0 && m.type !== 19) return false; // default + reply; skips joins, pins, boosts
  if ((m.attachments?.length ?? 0) > 0 || (m.sticker_items?.length ?? 0) > 0) return true;
  return (m.content ?? '').trim().length >= CHAT_MIN_CHARS;
}

const maxId = (a: string, b: string) => (BigInt(a) >= BigInt(b) ? a : b);

export interface ChatPollResult {
  channels: number;
  read: number;
  stored: number;
  caught_up: number;
  pending: string[];
  errors: string[];
}

/** Read new messages of every member channel until done or `budgetMs` runs out. */
export async function pollChat(supabase: SupabaseClient, opts: { budgetMs?: number } = {}): Promise<ChatPollResult> {
  const deadline = Date.now() + (opts.budgetMs ?? 120_000);
  const channels = await memberChannels();
  const { data: cursorRows, error } = await supabase.from('discord_chat_cursors').select('channel_id, last_message_id');
  if (error) throw new Error(error.message);
  const cursors = new Map((cursorRows ?? []).map((r) => [r.channel_id as string, r.last_message_id as string]));
  const out: ChatPollResult = { channels: channels.length, read: 0, stored: 0, caught_up: 0, pending: [], errors: [] };

  // Least-recently-read first, so a long backfill can't starve the others.
  const ordered = channels.slice().sort((a, b) => (BigInt(cursors.get(a.id) ?? '0') < BigInt(cursors.get(b.id) ?? '0') ? -1 : 1));
  for (const ch of ordered) {
    let cursor = cursors.get(ch.id) ?? '0';
    let done = false;
    try {
      while (Date.now() < deadline) {
        const batch = await listMessagesAfter(ch.id, cursor);
        out.read += batch.length;
        if (!batch.length) { done = true; break; }
        const rows = batch.filter(qualifies).map((m) => ({ message_id: m.id, discord_id: m.author.id, channel_id: ch.id, sent_at: m.timestamp }));
        if (rows.length) {
          const { error: e } = await supabase.from('discord_chat_messages').upsert(rows, { onConflict: 'message_id', ignoreDuplicates: true });
          if (e) throw new Error(e.message);
          out.stored += rows.length;
        }
        cursor = batch.reduce((m, x) => maxId(m, x.id), cursor);
        // Cursor after the rows: a crash in between re-reads the page, which is harmless.
        await supabase.from('discord_chat_cursors').upsert({ channel_id: ch.id, channel_name: ch.name, last_message_id: cursor, caught_up: batch.length < 100, updated_at: new Date().toISOString() });
        if (batch.length < 100) { done = true; break; }
      }
    } catch (err) {
      out.errors.push(`#${ch.name}: ${String(err instanceof Error ? err.message : err).slice(0, 200)}`);
    }
    if (done) out.caught_up++;
    else out.pending.push(ch.name);
  }
  return out;
}

// ─── Counting ────────────────────────────────────────────────────────────────

export interface ChatStats {
  /** Counted messages (after cooldown). */
  counted: number;
  /** UTC day → counted messages. */
  days: Map<string, number>;
  /** Counted message times (ms, ascending): for level crossing dates. */
  times: number[];
}

/** Counted chat per Discord id (all, or only the given ids). */
export async function chatStats(supabase: SupabaseClient, discordIds?: string[]): Promise<Map<string, ChatStats>> {
  const raw = new Map<string, number[]>();
  const load = async (ids: string[] | null) => {
    for (let from = 0; ; from += PAGE) {
      let q = supabase.from('discord_chat_messages').select('discord_id, sent_at').order('message_id').range(from, from + PAGE - 1);
      if (ids) q = q.in('discord_id', ids);
      const { data, error } = await q;
      if (error) {
        if (/discord_chat_messages/.test(error.message)) return; // migration not run yet
        throw new Error(error.message);
      }
      for (const r of data ?? []) {
        const a = raw.get(r.discord_id) ?? [];
        a.push(Date.parse(r.sent_at));
        raw.set(r.discord_id, a);
      }
      if (!data || data.length < PAGE) return;
    }
  };
  if (discordIds) {
    for (let i = 0; i < discordIds.length; i += 200) await load(discordIds.slice(i, i + 200));
  } else await load(null);

  const out = new Map<string, ChatStats>();
  for (const [id, times] of Array.from(raw)) {
    const counted = countedMessages(times);
    const days = new Map<string, number>();
    for (const t of counted) {
      const d = new Date(t).toISOString().slice(0, 10);
      days.set(d, (days.get(d) ?? 0) + 1);
    }
    out.set(id, { counted: counted.length, days, times: counted });
  }
  return out;
}

/** Days with enough counted messages for the pass. */
export const chatDays = (s: ChatStats | undefined) =>
  s ? Array.from(s.days.entries()).filter(([, n]) => n >= CHAT_DAY_MIN).map(([d]) => d) : [];

/** Channels currently read for chat XP (from the cursors), for /pass how and the website. */
export async function chatChannels(supabase: SupabaseClient): Promise<Array<{ id: string; name: string }>> {
  const { data } = await supabase.from('discord_chat_cursors').select('channel_id, channel_name').order('channel_name');
  return (data ?? []).map((r) => ({ id: r.channel_id as string, name: (r.channel_name as string | null) ?? r.channel_id }));
}
