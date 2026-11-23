/**
 * Discord live messages: bot posts the site keeps current instead of posting new ones.
 * State per key lives in `discord_live_messages` (database/discord-live-messages.sql).
 *
 * Two modes:
 *  - 'edit'   : edit the tracked messages in place (reference posts: directory, raid times, links).
 *               Extra payloads are posted, leftover messages deleted, deleted messages re-posted.
 *  - 'repost' : delete the old messages and post fresh ones (daily reports). Keeps one current
 *               copy at the bottom of a busy channel and lets @mentions notify, which edits never do.
 *  - 'append' : post fresh messages and keep the old ones (feeds like #hall-of-fame). Only the
 *               latest post is tracked.
 * Unchanged content (same hash, same channel) is skipped unless `force` is set.
 */
import { createHash } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  deleteChannelMessage,
  editChannelMessageRich,
  pinChannelMessage,
  postToChannelRich,
} from '@/lib/discord-api';

export interface LivePayload {
  content?: string;
  embeds?: unknown[];
  components?: unknown[];
  allowed_mentions?: unknown;
  flags?: number;
}

export type LiveMode = 'edit' | 'repost' | 'append';

export interface LiveRow {
  key: string;
  channel_id: string;
  message_ids: string[];
  content_hash: string | null;
  payloads: LivePayload[] | null;
  enabled: boolean;
  last_published_at: string | null;
  last_error: string | null;
}

export interface PublishResult {
  ok: boolean;
  status: 'published' | 'unchanged' | 'disabled' | 'unbound' | 'error';
  message_ids: string[];
  channel_id?: string;
  error?: string;
}

export const DISCORD_SERVER_ID = '1444748650923163802';
export const DISCORD_LIMIT = 2000;
const TABLE = 'discord_live_messages';

export const messageLink = (channelId: string, messageId: string) =>
  `https://discord.com/channels/${DISCORD_SERVER_ID}/${channelId}/${messageId}`;

// Discord allows 5 writes / 5 s per channel.
const pace = () => new Promise((r) => setTimeout(r, 1100));

const hashPayloads = (p: LivePayload[]) => createHash('sha256').update(JSON.stringify(p)).digest('hex');

/**
 * Split lines into message-sized chunks. When a chunk overflows, it is cut at its last blank
 * line if there is one, so sections (heading + rows) stay together in one message.
 */
export function chunkLines(lines: string[], limit = 1990): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  const size = (ls: string[]) => ls.join('\n').length;
  for (const raw of lines) {
    const line = raw.length > limit ? raw.slice(0, limit - 1) + '…' : raw;
    if (cur.length && size([...cur, line]) > limit) {
      const cut = cur.lastIndexOf('');
      const keep = cut > 0 ? cur.slice(0, cut) : cur;
      out.push(keep.join('\n').trim());
      cur = cut > 0 ? cur.slice(cut + 1) : [];
      // The carried-over section itself might still be too big with the new line.
      while (cur.length && size([...cur, line]) > limit) {
        out.push(cur.join('\n').trim());
        cur = [];
      }
    }
    cur.push(line);
  }
  if (cur.join('\n').trim()) out.push(cur.join('\n').trim());
  return out.filter(Boolean);
}

/** Text payloads, links unfurled off and no pings unless the caller opts in. */
export function textPayloads(lines: string[], opts: { pingUsers?: boolean } = {}): LivePayload[] {
  return chunkLines(lines).map((content) => ({
    content,
    flags: 4, // SUPPRESS_EMBEDS
    allowed_mentions: opts.pingUsers ? { parse: ['users'] } : { parse: [] },
  }));
}

export async function getLiveRow(supabase: SupabaseClient, key: string): Promise<LiveRow | null> {
  const { data } = await supabase.from(TABLE).select('*').eq('key', key).maybeSingle();
  return (data as LiveRow | null) ?? null;
}

export async function listLiveRows(supabase: SupabaseClient): Promise<LiveRow[]> {
  const { data, error } = await supabase.from(TABLE).select('*').order('key');
  if (error) throw new Error(error.message);
  return (data ?? []) as LiveRow[];
}

async function saveRow(supabase: SupabaseClient, key: string, patch: Partial<LiveRow>) {
  const { error } = await supabase
    .from(TABLE)
    .upsert({ key, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw new Error(`Saving live message ${key} failed: ${error.message}`);
}

/** Bind a key to a channel (creates the row). Messages in an old channel are removed on next publish. */
export async function bindLive(supabase: SupabaseClient, key: string, channelId: string) {
  const row = await getLiveRow(supabase, key);
  if (row && row.channel_id !== channelId) {
    for (const id of row.message_ids) {
      await deleteChannelMessage(row.channel_id, id);
      await pace();
    }
    await saveRow(supabase, key, { channel_id: channelId, message_ids: [], content_hash: null, enabled: true });
  } else if (!row) {
    await saveRow(supabase, key, { channel_id: channelId, message_ids: [], enabled: true });
  }
}

export async function setLiveEnabled(supabase: SupabaseClient, key: string, enabled: boolean) {
  await saveRow(supabase, key, { enabled } as Partial<LiveRow>);
}

/** Remove the row; optionally delete the bot's messages too. */
export async function unbindLive(supabase: SupabaseClient, key: string, deleteMessages: boolean) {
  const row = await getLiveRow(supabase, key);
  if (!row) return;
  if (deleteMessages) {
    for (const id of row.message_ids) {
      await deleteChannelMessage(row.channel_id, id);
      await pace();
    }
  }
  await supabase.from(TABLE).delete().eq('key', key);
}

/**
 * Publish payloads for a bound key. Does nothing for unbound or paused keys
 * (callers fall back to their old behaviour when this returns 'unbound').
 */
export async function publishLive(
  supabase: SupabaseClient,
  key: string,
  payloads: LivePayload[],
  opts: { mode: LiveMode; force?: boolean; pin?: boolean }
): Promise<PublishResult> {
  const row = await getLiveRow(supabase, key);
  if (!row) return { ok: false, status: 'unbound', message_ids: [] };
  if (!row.enabled) return { ok: false, status: 'disabled', message_ids: row.message_ids };
  if (payloads.length === 0) return { ok: false, status: 'error', message_ids: row.message_ids, error: 'Nothing to post' };

  const hash = hashPayloads(payloads);
  if (!opts.force && row.content_hash === hash && row.message_ids.length === payloads.length) {
    return { ok: true, status: 'unchanged', message_ids: row.message_ids, channel_id: row.channel_id };
  }

  const channel = row.channel_id;
  const used: string[] = [];
  const persist = (extra: Partial<LiveRow> = {}) =>
    saveRow(supabase, key, { channel_id: channel, message_ids: used.slice(), payloads, ...extra });

  let old = row.message_ids;
  try {
    if (opts.mode === 'repost') {
      for (const id of old) {
        await deleteChannelMessage(channel, id);
        await pace();
      }
      old = [];
      await saveRow(supabase, key, { message_ids: [] });
    } else if (opts.mode === 'append') {
      old = []; // keep earlier posts, just stop tracking them
    }

    for (let i = 0; i < payloads.length; i++) {
      let id: string | null = null;
      if (i < old.length) {
        const r = await editChannelMessageRich(channel, old[i], payloads[i] as Record<string, unknown>);
        if (r.ok) id = old[i];
        else if (!/ 404\b/.test(r.error ?? '')) throw new Error(r.error);
        // 404 = someone deleted it: fall through and post a replacement.
      }
      if (!id) {
        const r = await postToChannelRich(channel, payloads[i] as Record<string, unknown>);
        if (!r.ok || !r.messageId) throw new Error(r.error ?? 'Post failed');
        id = r.messageId;
        if (opts.pin && i === 0) await pinChannelMessage(channel, id); // best effort
      }
      used.push(id);
      await persist(); // never lose track of a posted message
      await pace();
    }

    // Shorter than before → drop the leftovers.
    for (const id of old.slice(payloads.length)) {
      await deleteChannelMessage(channel, id);
      await pace();
    }

    await persist({ content_hash: hash, last_published_at: new Date().toISOString(), last_error: null });
    return { ok: true, status: 'published', message_ids: used, channel_id: channel };
  } catch (err) {
    const error = String(err instanceof Error ? err.message : err);
    // Keep tracking old messages we never reached, so the next run edits or deletes them.
    used.push(...old.slice(used.length));
    await persist({ last_error: error }).catch(() => {});
    return { ok: false, status: 'error', message_ids: used, channel_id: channel, error };
  }
}
