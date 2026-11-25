/**
 * Assault eligibility (docs/assault-roster.md §10): claimed characters that aren't on an assault
 * roster, measured against the goals of every assault guild that is assaulting right now, at that
 * guild's tracked zone. Rows are
 * built with the roster's own `buildRosterRow`, so the maths is identical to /assault/roster.
 *
 * Snapshots live in `assault_eligibility_snapshots` (not `assault_roster`). Same IdleMMO cost as
 * the roster: 3 calls per character, keys allow ~20 requests/minute.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase-server';
import { getAccountCharacters, getAllClaimLocks } from '@/lib/account-service';
import { fetchCharacterSnapshot, SUPER_ADMIN_USER_ID } from '@/lib/combat/profile-service';
import { assaultMembers } from '@/lib/assault-roster-sync';
import { registerInterest } from '@/lib/recruit-service';
import type { GearSelection } from '@/lib/combat/character-stats';
import { postToChannelRich } from '@/lib/discord-api';
import {
  buildRosterRow, loadRowCatalog, loadRowMembers, zoneSlice,
  type RosterRow, type RosterRowContext, type RosterSnapshot,
} from '@/lib/assault-roster';
import {
  TRACKS, belowMinimum, evaluateGoals, meetsMinimum, mergeGoals, prerequisites,
  type GoalSet, type TrackId,
} from '@/lib/roster-goals';

/** Snapshots older than this are refreshed when the page loads. */
export const ELIGIBILITY_STALE_MS = 6 * 60 * 60 * 1000;
/** Manual refresh cooldown (same as /combat and the roster). */
export const ELIGIBILITY_MANUAL_MIN_AGE_MS = 2 * 60 * 1000;

/** One assault guild's rubric: its goals at its tracked assault zone. */
export interface GuildRubric {
  id: string;
  name: string;
  nickname: string | null;
  zoneId: number | null;
  zoneName: string | null;
  goals: GoalSet;
  /** assault_configs.active: the guild is assaulting right now (paused guilds are left out). */
  active: boolean;
}

/** Compact per-guild result, stored on the snapshot for the scouting list and Discord. */
export interface GuildVerdict {
  meets: boolean;
  /** Missing prerequisites (labels). */
  setup: string[];
  tiers: Partial<Record<TrackId, number>>;
  /** Non-bonus elements below Bronze (measured ones). */
  below: TrackId[];
  /** Top next moves (titles), best first. */
  moves: string[];
  zone: string | null;
}

export interface EligibilityGuildResult {
  guild: GuildRubric;
  row: RosterRow;
  verdict: GuildVerdict;
}

export interface EligibilityCharacter {
  member_id: string | null;
  hashed_id: string;
  ign: string;
  /** Current guild (any, Dream or not), display only. */
  guild_name: string | null;
  character_class: string | null;
  combat_level: number | null;
  image_url: string | null;
  last_sync: string | null;
  last_error: string | null;
  pets_hidden: boolean;
  results: EligibilityGuildResult[];
  /** Guild id: one they meet the minimum of, else the one with the fewest elements below Bronze. */
  closest: string | null;
}

interface SnapshotRow extends RosterSnapshot {
  location?: unknown;
  verdicts?: Record<string, GuildVerdict> | null;
}

/* ─── who ─── */

/** A character to measure: our members row (if any), hashed id, and whose key reads it. */
export interface EligibilityTarget {
  member_id: string | null;
  hashed_id: string;
  ign: string;
  /** Site user whose API key is tried first (owner); null = shared key. */
  key_user: string | null;
}

/** The viewer's claimed characters (incl. alts, inside or outside Dream) that aren't on an assault roster. */
export async function ownEligibilityTargets(
  userId: string,
  supabase: SupabaseClient = createAdminClient()
): Promise<(EligibilityTarget & { guild_name: string | null })[]> {
  const [chars, assault] = await Promise.all([getAccountCharacters(userId, supabase), assaultMembers(supabase)]);
  const onRoster = new Set(assault.map((m) => m.id));
  return chars
    .filter((c) => c.hashed_id && !onRoster.has(c.member_id))
    .map((c) => ({ member_id: c.member_id, hashed_id: c.hashed_id as string, ign: c.ign, key_user: userId, guild_name: c.guild_name }));
}

/** Every approved-claimed character outside the assault guilds (daily cron, staff scouting). */
export async function allEligibilityTargets(supabase: SupabaseClient = createAdminClient()): Promise<EligibilityTarget[]> {
  const [locks, assault] = await Promise.all([getAllClaimLocks(supabase), assaultMembers(supabase)]);
  const onRoster = new Set(assault.map((m) => m.id));
  const ids = Array.from(locks.entries()).filter(([id, l]) => l.status === 'approved' && !onRoster.has(id)).map(([id]) => id);
  const out: EligibilityTarget[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase.from('members').select('id, ign, hashed_id').in('id', ids.slice(i, i + 200)).not('hashed_id', 'is', null);
    for (const m of data ?? []) out.push({ member_id: m.id as string, hashed_id: m.hashed_id as string, ign: m.ign as string, key_user: locks.get(m.id as string)?.user_id ?? null });
  }
  return out;
}

/* ─── snapshots ─── */

export interface EligibilitySyncResult {
  synced: number;
  failed: { ign: string; error: string }[];
  /** Still due after the budget ran out. */
  remaining: number;
}

/** Same fetch as the roster sync, written to `assault_eligibility_snapshots`. Stalest attempt first. */
export async function syncEligibility(
  targets: EligibilityTarget[],
  opts: { minAgeMs: number; budgetMs: number },
  supabase: SupabaseClient = createAdminClient()
): Promise<EligibilitySyncResult> {
  const started = Date.now();
  const result: EligibilitySyncResult = { synced: 0, failed: [], remaining: 0 };
  if (!targets.length) return result;
  const { data: existing } = await supabase
    .from('assault_eligibility_snapshots')
    .select('hashed_id, last_attempt')
    .in('hashed_id', targets.map((t) => t.hashed_id));
  const lastAttempt = new Map((existing ?? []).map((r) => [r.hashed_id as string, r.last_attempt ? new Date(r.last_attempt as string).getTime() : 0]));
  const now = Date.now();
  const due = targets
    .filter((t) => now - (lastAttempt.get(t.hashed_id) ?? 0) >= opts.minAgeMs)
    .sort((a, b) => (lastAttempt.get(a.hashed_id) ?? 0) - (lastAttempt.get(b.hashed_id) ?? 0));

  for (let i = 0; i < due.length; i++) {
    if (Date.now() - started > opts.budgetMs) {
      result.remaining = due.length - i;
      break;
    }
    const t = due[i];
    const at = new Date().toISOString();
    try {
      const snap = await fetchCharacterSnapshot(t.key_user ?? SUPER_ADMIN_USER_ID, t.hashed_id);
      const { error } = await supabase.from('assault_eligibility_snapshots').upsert(
        {
          hashed_id: t.hashed_id,
          member_id: t.member_id,
          ign: snap.ign ?? t.ign,
          character_class: snap.character_class,
          image_url: snap.image_url,
          stats: snap.stats,
          skills: snap.skills,
          equipped_pet: snap.equipped_pet,
          effects: snap.effects,
          location: snap.location,
          // Hidden pets: keep the last known list instead of wiping it.
          ...(snap.keep_stored_pets ? {} : { pets: snap.pets }),
          pets_hidden: snap.keep_stored_pets,
          key_source: t.key_user && t.key_user !== SUPER_ADMIN_USER_ID ? snap.key_source : 'shared',
          last_error: null,
          last_sync: at,
          last_attempt: at,
          updated_at: at,
        },
        { onConflict: 'hashed_id' }
      );
      if (error) throw new Error(error.message);
      result.synced++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.failed.push({ ign: t.ign, error: msg });
      await supabase
        .from('assault_eligibility_snapshots')
        .upsert({ hashed_id: t.hashed_id, member_id: t.member_id, ign: t.ign, last_error: msg.slice(0, 300), last_attempt: at, updated_at: at }, { onConflict: 'hashed_id' });
    }
  }
  return result;
}

/* ─── measuring ─── */

/**
 * Assault guilds that are assaulting right now (assault_configs.active), each with its goals at its
 * tracked zone. A paused guild drops out everywhere (page, Discord, interest, scouting) and comes
 * back when it's switched on again. If none is active, all of them are used so the page isn't empty.
 */
export async function loadRubrics(supabase: SupabaseClient, zones: { id: number; name: string }[]): Promise<GuildRubric[]> {
  const { data: guilds } = await supabase.from('guilds').select('id, name, nickname').eq('is_assault', true).order('name');
  const ids = (guilds ?? []).map((g) => String(g.id));
  if (!ids.length) return [];
  const [{ data: configs }, { data: goalRows }] = await Promise.all([
    supabase.from('assault_configs').select('guild_id, tracked_zone_id, zone_name, active').in('guild_id', ids),
    supabase.from('assault_roster_goals').select('guild_id, goals').in('guild_id', ids),
  ]);
  const all = (guilds ?? []).map((g) => {
    const id = String(g.id);
    const cfg = (configs ?? []).find((c) => String(c.guild_id) === id);
    const zoneId = (cfg?.tracked_zone_id as number | null) ?? null;
    return {
      id,
      name: g.name as string,
      nickname: (g.nickname as string) ?? null,
      zoneId,
      zoneName: zones.find((z) => z.id === zoneId)?.name ?? (cfg?.zone_name as string) ?? null,
      goals: mergeGoals((goalRows ?? []).find((r) => String(r.guild_id) === id)?.goals),
      active: !!cfg?.active,
    };
  });
  const live = all.filter((g) => g.active);
  return live.length ? live : all;
}

export function verdictOf(row: RosterRow, goals: GoalSet, zone: string | null): GuildVerdict {
  const results = evaluateGoals(row, goals);
  return {
    meets: meetsMinimum(row, results),
    setup: prerequisites(row).filter((p) => !p.ok).map((p) => p.label),
    tiers: Object.fromEntries(results.filter((x) => x.measured).map((x) => [x.id, x.tier])),
    below: belowMinimum(row, results).filter((x) => x.measured).map((x) => x.id),
    // Setup is listed on its own; the moves are what comes after it.
    // Potions come after joining: not part of eligibility.
    moves: row.moves.filter((m) => m.kind !== 'setup' && m.track !== 'potions').slice(0, 3).map((m) => m.title),
    zone,
  };
}

/** Closest guild: one they meet the minimum of (highest tier sum), else the fewest elements below Bronze. */
export function closestGuild(results: { guild: { id: string }; verdict: GuildVerdict }[]): string | null {
  const score = (v: GuildVerdict) => (v.meets ? 1000 : 0) - v.setup.length * 100 - v.below.length * 10 + Object.values(v.tiers).reduce((a, b) => a + (b ?? 0), 0) / 100;
  return [...results].sort((a, b) => score(b.verdict) - score(a.verdict))[0]?.guild.id ?? null;
}

export const trackLabel = (id: TrackId) => TRACKS.find((t) => t.id === id)?.label ?? id;

/**
 * Builds every guild's rows for these snapshots and stores the verdicts on them.
 * `guildNames` = current guild per member for display.
 */
export async function measureSnapshots(
  hashedIds: string[],
  supabase: SupabaseClient = createAdminClient(),
  guildNames: Map<string, string | null> = new Map(),
  /**
   * Public lookup: ignore everything stored about the character (gear, bow, owner, loadout) and use
   * what the visitor picked in the browser instead; verdicts aren't stored. gear null = not picked.
   */
  override?: { gear: GearSelection[] | null; bow: string | null; planGear?: boolean }
): Promise<{ rubrics: GuildRubric[]; characters: EligibilityCharacter[] }> {
  const catalog = await loadRowCatalog(supabase);
  const rubrics = await loadRubrics(supabase, catalog.zones);
  if (!hashedIds.length) return { rubrics, characters: [] };
  const { data } = await supabase.from('assault_eligibility_snapshots').select('*').in('hashed_id', hashedIds);
  const raw = (data ?? []) as SnapshotRow[];
  const members = override
    ? await loadRowMembers(supabase, [], [])
    : await loadRowMembers(
        supabase,
        raw.map((s) => s.member_id).filter((id): id is string => !!id),
        raw.map((s) => s.hashed_id)
      );
  // Rows key on member_id; IGN lookups without a members row use the hashed id instead.
  // A failed first fetch leaves a row with no data: it's shown with its error, nothing to measure.
  const snaps = raw.map((s) => ({ ...s, member_id: s.member_id ?? s.hashed_id }));
  // Potions come after joining (user rule): eligibility always measures with the default preset.
  members.loadoutOf.clear();
  if (override) {
    for (const s of snaps) {
      if (override.gear) members.profileOf.set(s.hashed_id, { user_id: '', gear: override.gear, settings: override.gear.length ? {} : { noGear: true } });
      members.memberInfo.set(s.member_id, { position: null, hunting_bow: override.bow, discord_id: null });
    }
  }
  const zones = new Map(rubrics.map((g) => [g.id, zoneSlice(catalog, g.zoneId, g.goals)]));
  const now = new Date().toISOString();

  const characters: EligibilityCharacter[] = [];
  for (const s of snaps) {
    const measurable = !!s.last_sync;
    const results: EligibilityGuildResult[] = [];
    if (measurable) {
      for (const g of rubrics) {
        const ctx: RosterRowContext = { ...catalog, ...members, ...zones.get(g.id)!, answers: new Map(), planMinGear: !!override?.planGear };
        const row = buildRosterRow(s, ctx);
        results.push({ guild: g, row, verdict: verdictOf(row, g.goals, g.zoneName) });
      }
      const verdicts = Object.fromEntries(results.map((r) => [r.guild.id, r.verdict]));
      if (!override) await supabase.from('assault_eligibility_snapshots').update({ verdicts, verdicts_at: now }).eq('hashed_id', s.hashed_id);
    }
    const realMember = raw.find((x) => x.hashed_id === s.hashed_id)?.member_id ?? null;
    characters.push({
      member_id: realMember,
      hashed_id: s.hashed_id,
      ign: s.ign,
      guild_name: realMember ? guildNames.get(realMember) ?? null : null,
      character_class: s.character_class,
      combat_level: results[0]?.row.combat_level ?? null,
      image_url: s.image_url,
      last_sync: s.last_sync ?? null,
      last_error: s.last_error ?? null,
      pets_hidden: !!s.pets_hidden,
      results,
      closest: results.length ? closestGuild(results) : null,
    });
  }
  characters.sort((a, b) => (b.combat_level ?? 0) - (a.combat_level ?? 0));
  return { rubrics, characters };
}

/** The viewer's own characters: refresh stale snapshots inside the budget, then measure. */
export async function ownEligibility(
  userId: string,
  supabase: SupabaseClient = createAdminClient(),
  opts: { budgetMs?: number } = {}
) {
  const targets = await ownEligibilityTargets(userId, supabase);
  const sync = await syncEligibility(targets, { minAgeMs: ELIGIBILITY_STALE_MS, budgetMs: opts.budgetMs ?? 45_000 }, supabase);
  const names = new Map(targets.map((t) => [t.member_id as string, t.guild_name]));
  const measured = await measureSnapshots(targets.map((t) => t.hashed_id), supabase, names);
  return { ...measured, sync, targets };
}

/* ─── public lookup (signed-out visitors) ─── */

export const HASHED_ID_RE = /^[A-Za-z0-9]{12,32}$/;
/** A public read is reused this long before the game is asked again. */
const PUBLIC_REUSE_MS = 30 * 60 * 1000;
/** Fresh game reads per minute across all eligibility snapshots (shared key allows ~20 calls/min, 3 per read). */
const PUBLIC_READS_PER_MINUTE = 4;

/**
 * Anyone can check a character by its hashed id (shared API key). Nothing stored about the
 * character is shown (gear, bow, loadout): the visitor picks gear and bow in the browser.
 */
export async function publicEligibility(
  hashedId: string,
  override: { gear: GearSelection[] | null; bow: string | null; planGear?: boolean },
  supabase: SupabaseClient = createAdminClient()
): Promise<{ ok: true; character: EligibilityCharacter; rubrics: GuildRubric[] } | { ok: false; error: string; status: number }> {
  if (!HASHED_ID_RE.test(hashedId)) return { ok: false, error: "That doesn't look like a character id.", status: 400 };
  const { data: snap } = await supabase
    .from('assault_eligibility_snapshots')
    .select('hashed_id, member_id, ign, last_sync, last_attempt')
    .eq('hashed_id', hashedId)
    .maybeSingle();
  const now = Date.now();
  const synced = snap?.last_sync ? new Date(snap.last_sync as string).getTime() : 0;
  const attempted = snap?.last_attempt ? new Date(snap.last_attempt as string).getTime() : 0;

  if (now - synced > PUBLIC_REUSE_MS && now - attempted > ELIGIBILITY_MANUAL_MIN_AGE_MS) {
    const { count } = await supabase
      .from('assault_eligibility_snapshots')
      .select('hashed_id', { count: 'exact', head: true })
      .gte('last_attempt', new Date(now - 60_000).toISOString());
    if ((count ?? 0) >= PUBLIC_READS_PER_MINUTE) {
      if (!synced) return { ok: false, error: 'Lots of lookups right now. Try again in a minute.', status: 429 };
    } else {
      // Keep the link to our members row (a claimed character's snapshot keeps its member_id).
      const { data: m } = snap?.member_id
        ? { data: null }
        : await supabase.from('members').select('id, ign').eq('hashed_id', hashedId).maybeSingle();
      const res = await syncEligibility(
        [{ member_id: (snap?.member_id as string | null) ?? (m?.id as string | undefined) ?? null, hashed_id: hashedId, ign: (snap?.ign as string | undefined) ?? (m?.ign as string | undefined) ?? hashedId, key_user: null }],
        { minAgeMs: 0, budgetMs: 30_000 },
        supabase
      );
      if (res.failed.length && !synced) return { ok: false, error: "Couldn't read that character from the game. Check the id.", status: 404 };
    }
  } else if (!synced) {
    return { ok: false, error: "Couldn't read that character from the game. Check the id, or try again in a couple of minutes.", status: 404 };
  }

  const { characters, rubrics } = await measureSnapshots([hashedId], supabase, new Map(), override);
  const c = characters[0];
  if (!c?.results.length) return { ok: false, error: "Couldn't read that character from the game.", status: 404 };
  return { ok: true, character: { ...c, member_id: null, guild_name: null }, rubrics };
}

/**
 * Recruiter check (Admin → Recruiting): any character by hashed id. Gear can't be read from the game,
 * so it plans the cheapest tier-1 set that gets Battle to Bronze, then measures the checklist with
 * that set on (or with `gear` when the recruiter picked one). Same read limits as the public lookup.
 */
export async function recruiterCheck(
  hashedId: string,
  opts: { bow: string | null; gear: GearSelection[] | null },
  supabase: SupabaseClient = createAdminClient()
) {
  const plan = await publicEligibility(hashedId, { gear: [], bow: opts.bow, planGear: true }, supabase);
  if (!plan.ok) return plan;
  const minGear = plan.character.results.map((r) => ({ guild_id: r.guild.id, plan: r.row.battle.minGear ?? null }));
  const first = minGear[0]?.plan;
  const gear = opts.gear ?? (first?.items.map((i) => ({ slot: i.slot, gear_item_id: i.item_id, tier: 1 })) ?? []);
  const res = await publicEligibility(hashedId, { gear, bow: opts.bow }, supabase);
  if (!res.ok) return res;
  return { ...res, minGear, usingMinGear: !opts.gear };
}

/* ─── join interest ─── */

/** leadership-chat: join-interest notes go here, one shared channel, no ping (user decision 2026-11-25). */
export const INTEREST_CHANNEL_ID = '1444751853500760146';

const TIER_WORD = ['Not yet', 'Bronze', 'Silver', 'Gold', 'Crystal', 'Dream'];

/** Short staff note. Discord is core: no site links; the player's Discord is shown (not pinged) when known. */
export function interestNote(c: EligibilityCharacter, r: EligibilityGuildResult, discordId: string | null): string {
  const v = r.verdict;
  const core = (['battle', 'pet_hunt', 'battle_pet'] as TrackId[])
    .map((id) => `${trackLabel(id)} ${TIER_WORD[v.tiers[id] ?? 0]}`)
    .join(' · ');
  const who = `**${c.ign}**${discordId ? ` (<@${discordId}>)` : ''}`;
  const now = c.guild_name ? `now in ${c.guild_name}` : 'not in a Dream guild';
  return [
    `🙋 ${who} is interested in joining **${r.guild.nickname ?? r.guild.name}** (CL ${c.combat_level ?? '?'} ${c.character_class ?? ''}, ${now}).`,
    `Meets the minimum at ${v.zone ?? 'the assault zone'}: ${core}.`,
    'Added to the Recruiting list as interested. The guild move happens in game.',
  ].join('\n');
}

export async function expressInterest(
  userId: string,
  hashedId: string,
  guildId: string,
  supabase: SupabaseClient = createAdminClient()
): Promise<{ ok: true; posted: boolean } | { ok: false; error: string; status: number }> {
  const targets = await ownEligibilityTargets(userId, supabase);
  const target = targets.find((t) => t.hashed_id === hashedId);
  if (!target) return { ok: false, error: 'Not one of your characters outside the assault guilds', status: 403 };
  const { characters } = await measureSnapshots([hashedId], supabase, new Map([[target.member_id as string, target.guild_name]]));
  const c = characters[0];
  const r = c?.results.find((x) => x.guild.id === guildId);
  if (!c || !r) return { ok: false, error: 'Refresh this character first', status: 409 };
  if (!r.verdict.meets) return { ok: false, error: `${c.ign} doesn't meet the ${r.guild.nickname ?? r.guild.name} minimum yet`, status: 409 };

  const { previous, sameGuild } = await registerInterest(supabase, {
    ign: c.ign,
    guild_id: guildId,
    user_id: userId,
    snapshot: {
      guild_name: r.guild.nickname ?? r.guild.name,
      member_id: c.member_id,
      meets: r.verdict.meets,
      tiers: r.verdict.tiers as Record<string, number>,
      below: r.verdict.below.map(trackLabel),
      combat_level: c.combat_level,
      character_class: c.character_class,
    },
  });
  // One note per player and guild: a repeat click doesn't post again.
  if (previous === 'interested' && sameGuild) return { ok: true, posted: false };

  const [{ data: member }, { data: link }] = await Promise.all([
    c.member_id ? supabase.from('members').select('discord_id').eq('id', c.member_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from('user_discord_links').select('discord_id').eq('user_id', userId).maybeSingle(),
  ]);
  const discordId = ((member as { discord_id?: string | null } | null)?.discord_id ?? (link?.discord_id as string | undefined)) || null;
  const res = await postToChannelRich(INTEREST_CHANNEL_ID, { content: interestNote(c, r, discordId), allowed_mentions: { parse: [] } });
  return { ok: true, posted: res.ok };
}

/* ─── staff scouting ─── */

export interface ScoutRow {
  hashed_id: string;
  member_id: string | null;
  ign: string;
  character_class: string | null;
  combat_level: number | null;
  guild_name: string | null;
  last_sync: string | null;
  /** Guild ids whose minimum they meet. */
  meets: string[];
  verdicts: Record<string, GuildVerdict>;
  interest: { guild_id: string | null; at: string | null; status: string } | null;
}

/**
 * Staff scouting list (user decision: everyone who meets a minimum, not only the interested).
 * Reads the stored verdicts; interested players come first.
 */
export async function scoutingList(supabase: SupabaseClient = createAdminClient()): Promise<{ rubrics: GuildRubric[]; rows: ScoutRow[] }> {
  const [{ data: snaps }, { data: prospects }, { data: zonesRaw }] = await Promise.all([
    supabase.from('assault_eligibility_snapshots').select('hashed_id, member_id, ign, character_class, skills, verdicts, last_sync').not('verdicts_at', 'is', null),
    supabase.from('recruit_prospects').select('ign, status, interest_guild_id, interest_at'),
    supabase.from('combat_enemies').select('zone_id, zone_name').gte('zone_id', 1).lte('zone_id', 10),
  ]);
  const zones = Array.from(new Map((zonesRaw ?? []).map((z) => [z.zone_id as number, { id: z.zone_id as number, name: z.zone_name as string }])).values());
  const rubrics = await loadRubrics(supabase, zones);
  // Someone who moved into an assault guild since is on a roster now: not a scouting target.
  const onRoster = new Set((await assaultMembers(supabase)).map((m) => m.id));
  const memberIds = (snaps ?? []).map((s) => s.member_id as string | null).filter((id): id is string => !!id);
  const guildOf = new Map<string, string | null>();
  if (memberIds.length) {
    const [{ data: members }, { data: guilds }] = await Promise.all([
      supabase.from('members').select('id, current_guild_id, is_active').in('id', memberIds),
      supabase.from('guilds').select('id, name, nickname'),
    ]);
    const gName = new Map((guilds ?? []).map((g) => [String(g.id), (g.nickname as string) ?? (g.name as string)]));
    for (const m of members ?? []) guildOf.set(m.id as string, m.is_active && m.current_guild_id ? gName.get(String(m.current_guild_id)) ?? null : null);
  }
  const prospectOf = new Map((prospects ?? []).map((p) => [String(p.ign).toLowerCase(), p]));
  const rows: ScoutRow[] = [];
  for (const s of snaps ?? []) {
    if (s.member_id && onRoster.has(s.member_id as string)) continue;
    const verdicts = (s.verdicts ?? {}) as Record<string, GuildVerdict>;
    const meets = rubrics.filter((g) => verdicts[g.id]?.meets).map((g) => g.id);
    const p = prospectOf.get(String(s.ign).toLowerCase());
    const interest = p && p.interest_at ? { guild_id: (p.interest_guild_id as string) ?? null, at: p.interest_at as string, status: p.status as string } : null;
    if (!meets.length && !interest) continue;
    const skills = s.skills as Record<string, { level?: number }> | null;
    rows.push({
      hashed_id: s.hashed_id as string,
      member_id: (s.member_id as string) ?? null,
      ign: s.ign as string,
      character_class: (s.character_class as string) ?? null,
      combat_level: skills?.combat?.level ?? null,
      guild_name: s.member_id ? guildOf.get(s.member_id as string) ?? null : null,
      last_sync: (s.last_sync as string) ?? null,
      meets,
      verdicts,
      interest,
    });
  }
  rows.sort((a, b) => Number(!!b.interest) - Number(!!a.interest) || b.meets.length - a.meets.length || (b.combat_level ?? 0) - (a.combat_level ?? 0));
  return { rubrics, rows };
}

/** Daily cron tail: snapshot + measure claimed characters outside the assault guilds (feeds scouting). */
export async function syncAllEligibility(budgetMs: number, supabase: SupabaseClient = createAdminClient()) {
  const targets = await allEligibilityTargets(supabase);
  const sync = await syncEligibility(targets, { minAgeMs: 20 * 60 * 60 * 1000, budgetMs }, supabase);
  // Measure snapshots whose verdicts are older than their data (stored verdicts feed scouting and Discord).
  const want = new Set(targets.map((t) => t.hashed_id));
  const { data } = await supabase.from('assault_eligibility_snapshots').select('hashed_id, last_sync, verdicts_at').not('last_sync', 'is', null);
  const fresh = (data ?? [])
    .filter((r) => want.has(r.hashed_id as string) && (!r.verdicts_at || (r.verdicts_at as string) < (r.last_sync as string)))
    .map((r) => r.hashed_id as string);
  if (fresh.length) await measureSnapshots(fresh, supabase);
  return { ...sync, measured: fresh.length, targets: targets.length };
}

/* ─── phase 2: staff IGN lookup ─── */

/**
 * Staff lookup of any character we know a hashed id for (members table: Dream members, alts,
 * former members). Read with the owner's key when claimed, else the shared key. Same 6 h freshness
 * as the page. The IdleMMO API has no name search, so players we've never seen can't be looked up.
 */
export async function staffLookup(
  ign: string,
  supabase: SupabaseClient = createAdminClient()
): Promise<{ ok: true; character: EligibilityCharacter; rubrics: GuildRubric[] } | { ok: false; error: string }> {
  const { data: rows } = await supabase
    .from('members')
    .select('id, ign, hashed_id, is_active, current_guild_id')
    .ilike('ign', ign.replace(/[\\%_]/g, (c) => `\\${c}`))
    .not('hashed_id', 'is', null)
    .order('is_active', { ascending: false })
    .limit(1);
  const m = rows?.[0];
  if (!m) return { ok: false, error: `${ign} isn't in our members list, so there's no game id to read them with (the game API has no name search).` };
  const onRoster = (await assaultMembers(supabase)).some((a) => a.id === m.id);
  if (onRoster) return { ok: false, error: `${m.ign} is on an assault roster: use \`/roster ign:${m.ign}\`.` };
  const locks = await getAllClaimLocks(supabase);
  const lock = locks.get(m.id as string);
  const target: EligibilityTarget = {
    member_id: m.id as string,
    hashed_id: m.hashed_id as string,
    ign: m.ign as string,
    key_user: lock?.status === 'approved' ? lock.user_id : null,
  };
  await syncEligibility([target], { minAgeMs: ELIGIBILITY_STALE_MS, budgetMs: 30_000 }, supabase);
  let guildName: string | null = null;
  if (m.is_active && m.current_guild_id) {
    const { data: g } = await supabase.from('guilds').select('name').eq('id', m.current_guild_id).maybeSingle();
    guildName = (g?.name as string) ?? null;
  }
  const { characters, rubrics } = await measureSnapshots([target.hashed_id], supabase, new Map([[target.member_id as string, guildName]]));
  if (!characters[0]?.results.length) return { ok: false, error: characters[0]?.last_error ?? `Couldn't read ${m.ign} from the game.` };
  return { ok: true, character: characters[0], rubrics };
}
