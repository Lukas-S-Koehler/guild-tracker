/**
 * Dream calendar (Dream Hub step 14, F5). One list of upcoming events from three sources:
 *
 *  - raids:    computed from the fixed raid times in src/lib/raid-discord.ts (same as /raid and the
 *              #raid-pings schedule): regular raids for every active raid guild, the CL 25 extra raid
 *              for Cursed Dreamers. Event-only third raids are not listed (no data on when events run).
 *  - assault:  assault_configs (active, weekdays, launch time, skip date, pause, season window) via
 *              isAssaultDay, plus the season end date when set.
 *  - custom:   calendar_events (database/calendar-events.sql), staff-made: one-off or weekly.
 *
 * All times are UTC instants; pages and Discord show them in the viewer's local time.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { CL25_UTC, CURSED_DREAMERS_ID, REGULAR_UTC } from '@/lib/raid-discord';
import { isAssaultDay, type AssaultConfig } from '@/lib/assault-service';

export type CalendarKind = 'raid' | 'assault' | 'season' | 'event' | 'pool' | 'giveaway' | 'meeting' | 'other';

export const KIND_META: Record<CalendarKind, { label: string; emoji: string }> = {
  raid: { label: 'Raid', emoji: '⚔️' },
  assault: { label: 'Assault', emoji: '🛡️' },
  season: { label: 'Season', emoji: '🏁' },
  event: { label: 'Event', emoji: '🎉' },
  pool: { label: 'Pool', emoji: '💧' },
  giveaway: { label: 'Giveaway', emoji: '🎁' },
  meeting: { label: 'Meeting', emoji: '🗣️' },
  other: { label: 'Other', emoji: '📌' },
};

export const CUSTOM_KINDS = ['event', 'pool', 'giveaway', 'meeting', 'other'] as const;
export type CustomKind = (typeof CUSTOM_KINDS)[number];

export interface CalendarEvent {
  /** Stable per occurrence: `<source>:<id>:<start iso>`. */
  id: string;
  kind: CalendarKind;
  title: string;
  detail: string | null;
  /** Guilds this is for; empty = everyone. */
  guild_ids: string[];
  guild_tags: string[];
  start: string;
  end: string | null;
  all_day: boolean;
  /** calendar_events row id for staff-made events. */
  custom_id: string | null;
}

export interface CustomEventRow {
  id: string;
  title: string;
  description: string | null;
  guild_id: string | null;
  kind: CustomKind;
  starts_at: string | null;
  weekdays: number[] | null;
  time_utc: string | null;
  active_from: string | null;
  active_until: string | null;
  duration_minutes: number | null;
  created_by: string | null;
  created_at: string;
}

const DAY = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const at = (day: string, hh: number, mm = 0) => new Date(`${day}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00Z`);
const hm = (t: string) => t.split(':').map((n) => parseInt(n, 10)) as [number, number];

interface GuildRow { id: string; nickname: string | null; name: string | null; is_active: boolean | null; is_assault: boolean | null }

/** Weekly custom rows expanded into [from, to). */
function expandCustom(r: CustomEventRow, from: Date, to: Date): Array<{ start: Date; end: Date | null }> {
  const dur = r.duration_minutes ? r.duration_minutes * 60_000 : 0;
  if (r.starts_at) {
    const s = new Date(r.starts_at);
    const e = dur ? new Date(s.getTime() + dur) : null;
    return (e ?? s) >= from && s < to ? [{ start: s, end: e }] : [];
  }
  if (!r.weekdays?.length || !r.time_utc) return [];
  const [hh, mm] = hm(r.time_utc);
  const out: Array<{ start: Date; end: Date | null }> = [];
  for (let t = Date.parse(isoDay(from) + 'T00:00:00Z') - DAY; t < to.getTime(); t += DAY) {
    const day = isoDay(new Date(t));
    if (r.active_from && day < r.active_from) continue;
    if (r.active_until && day > r.active_until) continue;
    const s = at(day, hh, mm);
    if (!r.weekdays.includes(s.getUTCDay())) continue;
    const e = dur ? new Date(s.getTime() + dur) : null;
    if ((e ?? s) >= from && s < to) out.push({ start: s, end: e });
  }
  return out;
}

export async function loadCustomEvents(supabase: SupabaseClient): Promise<CustomEventRow[]> {
  const { data, error } = await supabase.from('calendar_events').select('*').order('created_at');
  if (error) {
    if (/calendar_events/.test(error.message)) return []; // migration not run yet
    throw new Error(error.message);
  }
  return (data ?? []) as CustomEventRow[];
}

/**
 * Events overlapping [from, from + days). Sorted by start. `from` defaults to now minus 1 hour so
 * a raid that just started is still listed.
 */
export async function buildCalendar(
  supabase: SupabaseClient,
  opts: { from?: Date; days?: number } = {}
): Promise<CalendarEvent[]> {
  const from = opts.from ?? new Date(Date.now() - 3600_000);
  const to = new Date(from.getTime() + (opts.days ?? 14) * DAY);

  const [{ data: guildData }, { data: configData }, custom] = await Promise.all([
    supabase.from('guilds').select('id, nickname, name, is_active, is_assault'),
    supabase
      .from('assault_configs')
      .select('guild_id, active, launch_time_utc, weekdays, skip_date, paused_until, season_start, season_end, zone_name'),
    loadCustomEvents(supabase),
  ]);
  const guilds = (guildData ?? []) as GuildRow[];
  const tagOf = new Map(guilds.map((g) => [g.id, g.nickname ?? g.name ?? g.id]));
  const tags = (ids: string[]) => ids.map((id) => tagOf.get(id) ?? id);
  const out: CalendarEvent[] = [];

  // Raids
  const raidGuilds = guilds.filter((g) => g.is_active && !g.is_assault).map((g) => g.id).sort((a, b) => (tagOf.get(a)! < tagOf.get(b)! ? -1 : 1));
  const cursed = guilds.some((g) => g.id === CURSED_DREAMERS_ID && g.is_active);
  for (let t = Date.parse(isoDay(from) + 'T00:00:00Z'); t < to.getTime(); t += DAY) {
    const day = isoDay(new Date(t));
    if (raidGuilds.length) {
      REGULAR_UTC.forEach((h, i) => {
        const s = at(day, h);
        if (s >= from && s < to)
          out.push({
            id: `raid:${i}:${s.toISOString()}`,
            kind: 'raid',
            title: `Raids (${i === 0 ? '1st' : '2nd'} of the day)`,
            detail: 'Every raid guild runs its CL raid.',
            guild_ids: raidGuilds,
            guild_tags: tags(raidGuilds),
            start: s.toISOString(),
            end: null,
            all_day: false,
            custom_id: null,
          });
      });
    }
    if (cursed) {
      const s = at(day, CL25_UTC);
      if (s >= from && s < to)
        out.push({
          id: `raid:cl25:${s.toISOString()}`,
          kind: 'raid',
          title: 'Extra CL 25 raid',
          detail: 'Cursed Dreamers only.',
          guild_ids: [CURSED_DREAMERS_ID],
          guild_tags: tags([CURSED_DREAMERS_ID]),
          start: s.toISOString(),
          end: null,
          all_day: false,
          custom_id: null,
        });
    }
  }

  // Assault launches + season end
  type Cfg = Pick<AssaultConfig, 'weekdays' | 'season_start' | 'season_end' | 'skip_date' | 'paused_until' | 'active' | 'launch_time_utc'> & {
    guild_id: string;
    zone_name: string | null;
  };
  for (const c of (configData ?? []) as Cfg[]) {
    if (!c.active || !c.launch_time_utc) continue;
    const [hh, mm] = hm(c.launch_time_utc);
    for (let t = Date.parse(isoDay(from) + 'T00:00:00Z'); t < to.getTime(); t += DAY) {
      const s = at(isoDay(new Date(t)), hh, mm);
      if (s < from || s >= to || !isAssaultDay(c, s)) continue;
      out.push({
        id: `assault:${c.guild_id}:${s.toISOString()}`,
        kind: 'assault',
        title: 'Assault launch',
        detail: c.zone_name ? `Zone: ${c.zone_name}` : null,
        guild_ids: [c.guild_id],
        guild_tags: tags([c.guild_id]),
        start: s.toISOString(),
        end: null,
        all_day: false,
        custom_id: null,
      });
    }
    if (c.season_end) {
      const s = new Date(c.season_end + 'T00:00:00Z');
      if (s.getTime() + DAY > from.getTime() && s < to)
        out.push({
          id: `season:${c.guild_id}:${c.season_end}`,
          kind: 'season',
          title: 'Assault season ends',
          detail: 'Season recap posts the day after.',
          guild_ids: [c.guild_id],
          guild_tags: tags([c.guild_id]),
          start: s.toISOString(),
          end: null,
          all_day: true,
          custom_id: null,
        });
    }
  }

  // Staff-made events
  for (const r of custom) {
    for (const o of expandCustom(r, from, to)) {
      const ids = r.guild_id ? [r.guild_id] : [];
      out.push({
        id: `custom:${r.id}:${o.start.toISOString()}`,
        kind: r.kind,
        title: r.title,
        detail: r.description,
        guild_ids: ids,
        guild_tags: tags(ids),
        start: o.start.toISOString(),
        end: o.end?.toISOString() ?? null,
        all_day: false,
        custom_id: r.id,
      });
    }
  }

  return out.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.title.localeCompare(b.title)));
}

/** Events for a viewer: everyone-events plus their guilds' events. */
export const forGuilds = (events: CalendarEvent[], guildIds: Set<string>) =>
  events.filter((e) => e.guild_ids.length === 0 || e.guild_ids.some((g) => guildIds.has(g)));

// ─── iCalendar feed ──────────────────────────────────────────────────────────

const icsEscape = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (c) => `\\${c}`);
const icsTime = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
/** Lines over 75 octets are folded (RFC 5545), never inside a UTF-8 character. */
const fold = (line: string) => {
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of Array.from(line)) {
    const n = Buffer.byteLength(ch);
    if (bytes + n > 74) {
      out.push(cur);
      cur = ' ';
      bytes = 1;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join('\r\n');
};

export function toIcs(events: CalendarEvent[], name: string, site: string): string {
  const stamp = icsTime(new Date().toISOString());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Dream Guilds//Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEscape(name)}`,
    'X-PUBLISHED-TTL:PT6H',
    'REFRESH-INTERVAL;VALUE=DURATION:PT6H',
  ];
  for (const e of events) {
    const tagPart = e.guild_tags.length && e.guild_tags.length <= 3 ? ` · ${e.guild_tags.join(', ')}` : '';
    lines.push('BEGIN:VEVENT', `UID:${icsEscape(e.id)}@dream-guilds`, `DTSTAMP:${stamp}`);
    if (e.all_day) {
      const d = e.start.slice(0, 10).replace(/-/g, '');
      const next = new Date(Date.parse(e.start) + DAY).toISOString().slice(0, 10).replace(/-/g, '');
      lines.push(`DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${next}`);
    } else {
      lines.push(`DTSTART:${icsTime(e.start)}`, `DTEND:${icsTime(e.end ?? new Date(Date.parse(e.start) + 30 * 60_000).toISOString())}`);
    }
    lines.push(`SUMMARY:${icsEscape(`${KIND_META[e.kind].emoji} ${e.title}${tagPart}`)}`);
    const desc = [e.detail, e.guild_tags.length ? `Guilds: ${e.guild_tags.join(', ')}` : 'All Dream guilds', `${site}/calendar`].filter(Boolean).join('\n');
    lines.push(`DESCRIPTION:${icsEscape(desc)}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

// ─── Discord text ────────────────────────────────────────────────────────────

const unix = (iso: string) => Math.floor(Date.parse(iso) / 1000);

/**
 * Discord lines for a calendar: the daily raids are summarised once (they repeat every day), then
 * every other event grouped by UTC day with Discord timestamps (shown in each reader's local time).
 */
export function calendarDiscordLines(events: CalendarEvent[], opts: { live?: boolean } = {}): string[] {
  const lines: string[] = [];
  const raids = events.filter((e) => e.kind === 'raid');
  const firstDay = raids[0]?.start.slice(0, 10);
  const todayRaids = raids.filter((e) => e.start.slice(0, 10) === firstDay);
  if (todayRaids.length) {
    const slot = (e: CalendarEvent) => `<t:${unix(e.start)}:t>${e.guild_ids.length === 1 ? ` (${e.guild_tags[0]} only)` : ''}`;
    lines.push(`⚔️ **Raids every day:** ${todayRaids.map(slot).join(' · ')}`, '');
  }
  const rest = events.filter((e) => e.kind !== 'raid');
  if (!rest.length) {
    lines.push('_No assaults or guild events scheduled._');
    return lines;
  }
  let day = '';
  for (const e of rest) {
    const d = e.start.slice(0, 10);
    if (d !== day) {
      day = d;
      lines.push(`**<t:${unix(e.all_day ? d + 'T12:00:00Z' : e.start)}:D>**`);
    }
    const when = e.all_day ? 'all day' : opts.live ? `<t:${unix(e.start)}:t>` : `<t:${unix(e.start)}:t> (<t:${unix(e.start)}:R>)`;
    const who = e.guild_tags.length ? ` · ${e.guild_tags.join(', ')}` : '';
    lines.push(`${KIND_META[e.kind].emoji} ${when} **${e.title}**${who}${e.detail ? ` · ${e.detail}` : ''}`);
  }
  return lines;
}
