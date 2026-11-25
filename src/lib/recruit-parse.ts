/**
 * Parsers for text copied out of IdleMMO for the recruit tracker. Pure, used by client and API.
 */

/** interested = the player raised their hand on /assault/eligibility (or /eligibility in Discord). */
export type RecruitStatus = 'interested' | 'messaged' | 'replied' | 'joined' | 'declined' | 'skip_guild' | 'skip_weak';
export type RecruitLanguage = 'en' | 'de';

/** Days a skip lasts before the player shows as "to check" again. */
export const RECHECK_DAYS: Partial<Record<RecruitStatus, number>> = { skip_guild: 14, skip_weak: 30 };

/** Statuses an inbox import may set, in the order they can only move forward. */
const PROGRESS: Record<RecruitStatus, number> = {
  skip_guild: 0, skip_weak: 0, interested: 0, messaged: 1, replied: 2, declined: 3, joined: 4,
};
/** True when an automatic update from `from` to `to` moves forward (manual edits ignore this). */
export const isForward = (from: RecruitStatus | null | undefined, to: RecruitStatus) =>
  !from || PROGRESS[to] > PROGRESS[from];

export const TEMPLATES: Record<RecruitLanguage, (location: string) => string> = {
  en: (loc) =>
    `Hey there! Just noticed you were battling in ${loc} and was wondering if you would be interested in joining our guild for assaults there?`,
  de: (loc) =>
    `Servus! Hab gerade gemerkt, dass du in ${loc} kämpfst, und wollte fragen, ob es dich interessieren würde, in unserer Guild bei den Assaults mitzumachen?`,
};

/** Recognises our own recruit message (any location). Returns language + location. */
export function matchTemplate(text: string): { language: RecruitLanguage; location: string } | null {
  const en = text.match(/Just noticed you were (?:battling|hunting) in (.+?) and was wondering/i);
  if (en) return { language: 'en', location: titleCase(en[1].trim()) };
  const de = text.match(/dass du in (.+?) (?:kämpfst|jagst)/i);
  if (de) return { language: 'de', location: titleCase(de[1].trim()) };
  return null;
}

const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

// ---------------------------------------------------------------------------
// Nearby Characters
// ---------------------------------------------------------------------------

export interface NearbyChar {
  ign: string;
  tag: string | null;
  activity: string | null;
}

const ACTIVITY = /^(hunting|battling|fishing|mining|woodcutting|idle|dungeon|raiding|travelling|traveling)$/i;
const NOISE = /^(nearby characters|and \d+ more characters? nearby\.?)$/i;
const TAG = /^[A-Za-z0-9]{2,5}$/;

/**
 * Parses the in-game "Nearby Characters" panel. Each entry is rendered as
 * "Name / Name / [TAG] / Activity". Falls back to one name per line when no activity lines exist.
 */
export function parseNearby(text: string): NearbyChar[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !NOISE.test(l));
  const out = new Map<string, NearbyChar>();
  const add = (c: NearbyChar) => {
    if (!out.has(c.ign.toLowerCase())) out.set(c.ign.toLowerCase(), c);
  };

  if (!lines.some((l) => ACTIVITY.test(l))) {
    for (const l of lines) if (/^[A-Za-z0-9_]{2,30}$/.test(l)) add({ ign: l, tag: null, activity: null });
    return Array.from(out.values());
  }

  let group: string[] = [];
  for (const l of lines) {
    if (!ACTIVITY.test(l)) {
      group.push(l);
      continue;
    }
    if (group.length) {
      const ign = group[0];
      const rest = group.slice(1).filter((g) => g !== ign);
      const tag = rest.length && TAG.test(rest[rest.length - 1]) ? rest[rest.length - 1] : null;
      add({ ign, tag, activity: l });
    }
    group = [];
  }
  return Array.from(out.values());
}

// ---------------------------------------------------------------------------
// Inbox / message list
// ---------------------------------------------------------------------------

export interface InboxEntry {
  ign: string;
  kind: 'sent' | 'reply';
  language: RecruitLanguage | null;
  location: string | null;
  text: string;
  at: string | null; // ISO, approximate (from "2 days ago")
}

const AGO = /^(\d+|an?|one)\s+(second|minute|hour|day|week|month)s?\s+ago$/i;
const UNIT_MS: Record<string, number> = {
  second: 1e3, minute: 6e4, hour: 36e5, day: 864e5, week: 6048e5, month: 2592e6,
};

function agoToIso(line: string, now: number): string | null {
  const m = line.match(AGO);
  if (!m) return null;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : 1;
  return new Date(now - n * UNIT_MS[m[2].toLowerCase()]).toISOString();
}

/**
 * Parses a copy of the in-game message list (HTML + text as it pastes). Each entry starts with a
 * profile link `web.idle-mmo.com/@Name`. Our own template text = sent; anything else = a reply in
 * that conversation. Several entries for one player are all returned (newest first, as pasted).
 */
export function parseInbox(text: string, now = Date.now()): InboxEntry[] {
  const parts = text.split(/<a[^>]*href=['"]https?:\/\/web\.idle-mmo\.com\/@/i).slice(1);
  const out: InboxEntry[] = [];
  for (const part of parts) {
    const ign = part.match(/^([A-Za-z0-9_]+)/)?.[1];
    if (!ign) continue;
    const after = part.slice(part.lastIndexOf('</a>') + 4).replace(/<[^>]+>/g, '');
    const lines = after.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    let at: string | null = null;
    const body: string[] = [];
    for (const l of lines) {
      if (l === ign || l === 'Reply') continue;
      const ago = agoToIso(l, now);
      if (ago) { at = ago; continue; }
      if (!body.length && !at && TAG.test(l) && l === l.toUpperCase()) continue; // guild tag
      body.push(l);
    }
    const msg = body.join(' ').trim();
    if (!msg) continue;
    const tpl = matchTemplate(msg);
    out.push({
      ign,
      kind: tpl ? 'sent' : 'reply',
      language: tpl?.language ?? null,
      location: tpl?.location ?? null,
      text: msg,
      at,
    });
  }
  return out;
}
