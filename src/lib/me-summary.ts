/**
 * Personal dashboard data for /me.
 *
 * The unit is a guild group: all of the user's characters in the same Dream guild.
 * Same-guild alts count as one member for activity (any of them meeting the
 * requirement covers the group), exactly like /api/reports/inactivity, so the
 * member sees the same picture staff do.
 *
 * Scopes:
 *  - account (default): every character, one daily-check row and streak per group
 *  - group (?guild_id= or ?member_id= of a character in a Dream guild): that group's
 *    characters, logs limited to that guild
 *  - character (?member_id= of a character outside Dream): that character's history
 *
 * Activity is only checked once a day (GitHub daily-activity at 11:48 UTC), so the
 * page reports the last checked game day instead of pretending to be live.
 * Guild min_level and raid requirements are combat levels (CL), not total level.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAccountCharacters, type AccountCharacter } from '@/lib/account-service';
import { DAY_BOUNDARY_OFFSET_MINUTES } from '@/lib/activity-processor';
import { IdleMMOApi } from '@/lib/idlemmo-api';
import { ASSAULT_ENTRY_GUILD_ID, ASSAULT_TOP_MIN_CL, ASSAULT_TOP_GUILD_ID, bestRaidFor, guildRaids, type Raid } from '@/lib/raids';
import {
  findLastMetWeek,
  getISOWeekKey,
  getWarningInfo,
  getWeekSunday,
  type RequirementPeriod,
  type WarningLevel,
} from '@/lib/warning-calculator';

const DAY_MS = 86_400_000;
const CL_REFRESH_MS = DAY_MS;
/** Daily check: GitHub daily-activity.yml cron '48 11 * * *'. */
const CHECK_UTC = { h: 11, m: 48 };
const ASSAULT_TOP_GUILD = ASSAULT_TOP_GUILD_ID;
const ASSAULT_ENTRY_GUILD = ASSAULT_ENTRY_GUILD_ID;

interface LogRow {
  member_id: string;
  log_date: string;
  guild_id: string | null;
  raids: number | null;
  gold_donated: number | null;
  deposits_gold: number | null;
  met_requirement: boolean | null;
  bank_used: number | null;
}

interface GuildRow {
  id: string;
  name: string;
  nickname: string | null;
  min_level: number | null;
  display_order: number | null;
  is_active: boolean | null;
  is_assault: boolean | null;
}

interface GuildCfg {
  period: RequirementPeriod;
  dailyReq: number;
  weeklyReq: number;
  depositsOnly: boolean;
  overflow: boolean;
  settings: Record<string, unknown>;
  apiKey: string | null;
}

export interface FeedItem {
  at: string;
  kind: 'day' | 'warning' | 'join' | 'assault';
  title: string;
  detail?: string;
  tone: 'good' | 'bad' | 'warn' | 'info';
}

export interface Nudge {
  /** assault = DE → DI (hardcore assaults); assault_entry = top raid tier with CL 100+ → DE. */
  kind: 'eligible' | 'next' | 'assault' | 'assault_entry';
  guild_name: string;
  min_level: number;
  levels_needed: number;
}

export interface CharacterCard extends AccountCharacter {
  /** Guild id of the character's active Dream guild group, else null. */
  group_id: string | null;
  last_seen: string | null;
  combat_level: number | null;
  best_raid: Raid | null;
  nudge: Nudge | null;
}

export interface GuildGroup {
  guild_id: string;
  guild_name: string;
  guild_nickname: string | null;
  period: RequirementPeriod;
  required: number;
  deposits_only: boolean;
  is_assault: boolean;
  /** Always empty for assault guilds. */
  raids: Raid[];
  members: {
    member_id: string;
    ign: string;
    /** Daily: gold on the checked day. Weekly: this character's week total as of the last check. */
    contributed: number;
    met: boolean;
    bank_balance: number | null;
  }[];
  /** Group covered for the checked day/week: any character met. */
  met: boolean;
  days_inactive: number;
  last_met: string | null;
  warning_level: WarningLevel;
  exempt: boolean;
  week_end?: string;
  streak: { current: number; best: number; unit: 'day' | 'week' };
}

export interface MeSummary {
  claimed: true;
  scope: 'account' | 'group' | 'character';
  /** Selected group (scope=group) or character (scope=character). */
  selected: { guild_id: string | null; member_id: string | null; label: string };
  main: CharacterCard;
  tiles: {
    lifetime_raids: number;
    lifetime_gold: number;
    days_met: number;
    days_logged: number;
    gold_30d: number;
    raids_30d: number;
    assault_kills: number;
    assault_experience: number;
    assault_runs: number;
  };
  check: { checked_day: string; next_check_at: string };
  groups: GuildGroup[];
  status: { warning_level: WarningLevel; exempt: boolean; has_requirement: boolean };
  /** Scope switcher: every guild group, then characters without an active Dream guild. */
  switcher: { guild_id: string | null; member_id: string | null; label: string }[];
  /** Only for scope=character (outside Dream): that character's own met-day streak. */
  streak: { current: number; best: number; unit: 'day' | 'week' } | null;
  heatmap: { date: string; level: 0 | 1 | 2 | 3 }[];
  feed: FeedItem[];
  journey: { member_id: string; ign: string; guild_id: string; name: string; from: string; to: string; days_logged: number; current: boolean }[];
  characters: CharacterCard[];
  warnings: {
    id: string;
    ign: string;
    guild_nickname: string | null;
    warning_level: string;
    reason: string | null;
    is_auto: boolean;
    created_at: string;
  }[];
}

export type MeSummaryResult = MeSummary | { claimed: false; pending: { ign: string } | null };

/** Game-day date (YYYY-MM-DD) for an instant; boundary 11:50 UTC. */
export function gameDayOf(d = new Date()): string {
  return new Date(d.getTime() - DAY_BOUNDARY_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);
}

const addDays = (date: string, n: number) =>
  new Date(new Date(date + 'T00:00:00Z').getTime() + n * DAY_MS).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) =>
  Math.round((new Date(b + 'T00:00:00Z').getTime() - new Date(a + 'T00:00:00Z').getTime()) / DAY_MS);
const sev: Record<WarningLevel, number> = { safe: 0, warn1: 1, warn2: 2, kick: 3 };

function nextCheckAt(now = new Date()): string {
  const t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), CHECK_UTC.h, CHECK_UTC.m));
  if (t <= now) t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString();
}

async function fetchLogs(supabase: SupabaseClient, memberIds: string[]): Promise<LogRow[]> {
  const out: LogRow[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase
      .from('daily_logs')
      .select('member_id, log_date, guild_id, raids, gold_donated, deposits_gold, met_requirement, bank_used')
      .in('member_id', memberIds)
      .order('log_date', { ascending: false })
      .range(from, from + page - 1);
    if (error || !data) break;
    out.push(...(data as LogRow[]));
    if (data.length < page) break;
  }
  return out;
}

const gross = (l: LogRow, depositsOnly = false) =>
  depositsOnly ? Number(l.deposits_gold ?? 0) : Number(l.gold_donated ?? 0) + Number(l.deposits_gold ?? 0);

/**
 * Combat level per character, refreshed from the API at most once a day.
 * Needs database/add-member-combat-level.sql; without it, returns nulls.
 */
async function loadCombatLevels(
  supabase: SupabaseClient,
  chars: AccountCharacter[],
  cfgs: Map<string, GuildCfg>
): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  const { data, error } = await supabase
    .from('members')
    .select('id, combat_level, combat_level_synced_at')
    .in('id', chars.map((c) => c.member_id));
  if (error) return out; // column not migrated yet
  const rows = new Map((data ?? []).map((r) => [r.id as string, r]));
  let anyKey = Array.from(cfgs.values()).find((c) => c.apiKey)?.apiKey ?? null;
  if (!anyKey) {
    // No active Dream guild on this account: any guild's key can read public character info.
    const { data: k } = await supabase.from('guild_config').select('api_key').not('api_key', 'is', null).limit(1).maybeSingle();
    anyKey = (k?.api_key as string | null) ?? null;
  }

  await Promise.all(
    chars.map(async (c) => {
      const row = rows.get(c.member_id);
      out.set(c.member_id, (row?.combat_level as number | null) ?? null);
      const fresh = row?.combat_level_synced_at && Date.now() - new Date(row.combat_level_synced_at).getTime() < CL_REFRESH_MS;
      const key = (c.guild_id && cfgs.get(c.guild_id)?.apiKey) || anyKey;
      if (fresh || !c.hashed_id || !key) return;
      try {
        const info = await new IdleMMOApi(key).getCharacterInformation(c.hashed_id);
        const cl = info.skills?.combat?.level;
        if (typeof cl === 'number' && cl > 0) {
          out.set(c.member_id, cl);
          await supabase
            .from('members')
            .update({ combat_level: cl, combat_level_synced_at: new Date().toISOString() })
            .eq('id', c.member_id);
        }
      } catch (e) {
        console.warn('[me-summary] combat level fetch failed for', c.ign, e);
      }
    })
  );
  return out;
}

/** Consecutive met days ending at `end` (or today if already met) and the best run. */
function dayStreak(met: Set<string>, today: string, end: string) {
  let cur = 0;
  let d = met.has(today) ? today : end;
  while (met.has(d)) {
    cur++;
    d = addDays(d, -1);
  }
  const sorted = Array.from(met).sort();
  let best = 0;
  let run = 0;
  for (let i = 0; i < sorted.length; i++) {
    run = i > 0 && daysBetween(sorted[i - 1], sorted[i]) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
  }
  return { current: cur, best: Math.max(best, cur), unit: 'day' as const };
}

/** Consecutive met ISO weeks; an unfinished current week doesn't break it. */
function weekStreak(metWeeks: Set<string>, today: string) {
  let cur = 0;
  let d = today;
  if (!metWeeks.has(getISOWeekKey(d))) d = addDays(d, -7);
  while (metWeeks.has(getISOWeekKey(d))) {
    cur++;
    d = addDays(d, -7);
  }
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const k of Array.from(metWeeks).sort()) {
    run = prev && getISOWeekKey(addDays(getWeekSunday(prev), 1)) === k ? run + 1 : 1;
    best = Math.max(best, run);
    prev = k;
  }
  return { current: cur, best: Math.max(best, cur), unit: 'week' as const };
}

export async function buildMeSummary(
  userId: string,
  opts: { memberId?: string | null; guildId?: string | null },
  supabase: SupabaseClient
): Promise<MeSummaryResult> {
  const characters = await getAccountCharacters(userId, supabase);
  if (characters.length === 0) {
    const { data: pending } = await supabase
      .from('user_characters')
      .select('member:members(ign)')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .maybeSingle();
    const ign = (pending?.member as unknown as { ign: string } | null)?.ign;
    return { claimed: false, pending: ign ? { ign } : null };
  }

  const main =
    characters.find((c) => c.claimed && c.in_dream_guild) ??
    characters.find((c) => c.in_dream_guild) ??
    characters.find((c) => c.claimed) ??
    characters[0];
  const bundleIds = characters.map((c) => c.member_id);
  // Inactive guilds have no requirement (the officer report skips them too), so their
  // characters are treated like characters outside Dream.
  const { data: activeRows } = await supabase.from('guilds').select('id').neq('is_active', false);
  const activeGuilds = new Set((activeRows ?? []).map((g) => g.id as string));
  const inGuild = (c: AccountCharacter) => (c.in_dream_guild && c.guild_id && activeGuilds.has(c.guild_id) ? c.guild_id : null);
  const dreamGuildIds = Array.from(new Set(characters.map(inGuild).filter((g): g is string => !!g)));

  // Resolve scope
  const picked = opts.memberId ? characters.find((c) => c.member_id === opts.memberId) : undefined;
  const scopeGuild = (opts.guildId && dreamGuildIds.includes(opts.guildId) ? opts.guildId : null) ?? (picked ? inGuild(picked) : null);
  const scope: MeSummary['scope'] = scopeGuild ? 'group' : picked ? 'character' : 'account';
  const scopeChars =
    scope === 'group' ? characters.filter((c) => inGuild(c) === scopeGuild) : scope === 'character' ? [picked!] : characters;
  const scopeIds = new Set(scopeChars.map((c) => c.member_id));

  const [{ data: memberRows }, { data: guildRows }, logs, { data: warningRows }, { data: cfgRows }, { data: bankRows }] =
    await Promise.all([
      supabase.from('members').select('id, first_seen, last_seen, character_id, hashed_id').in('id', bundleIds),
      supabase.from('guilds').select('id, name, nickname, min_level, display_order, is_active, is_assault'),
      fetchLogs(supabase, bundleIds),
      supabase
        .from('warnings')
        .select('id, member_id, guild_id, warning_level, reason, is_auto, created_at')
        .in('member_id', bundleIds)
        .order('created_at', { ascending: false })
        .limit(25),
      supabase.from('guild_config').select('guild_id, api_key, settings').in('guild_id', dreamGuildIds.length ? dreamGuildIds : ['-']),
      supabase.from('member_gold_bank').select('member_id, guild_id, balance').in('member_id', bundleIds),
    ]);
  const memberMap = new Map((memberRows ?? []).map((m) => [m.id as string, m]));
  const guilds = (guildRows ?? []) as GuildRow[];
  const guildMap = new Map(guilds.map((g) => [g.id, g]));
  const ignOf = new Map(characters.map((c) => [c.member_id, c.ign]));

  const cfgs = new Map<string, GuildCfg>();
  for (const r of cfgRows ?? []) {
    const s = (r.settings ?? {}) as Record<string, unknown>;
    cfgs.set(r.guild_id as string, {
      period: s.requirement_period === 'weekly' ? 'weekly' : 'daily',
      dailyReq: Number(s.donation_requirement ?? 5000),
      weeklyReq: Number(s.weekly_donation_requirement ?? 35000),
      depositsOnly: s.deposits_only === true,
      overflow: s.overflow_enabled !== false,
      settings: s,
      apiKey: (r.api_key as string | null) ?? null,
    });
  }

  const combatLevels = await loadCombatLevels(supabase, characters, cfgs);

  const now = new Date();
  const today = gameDayOf(now);
  const checkedDay = addDays(today, -1); // last game day the 11:48 check covered
  // Officer report counts days up to calendar-yesterday; mirror it exactly.
  const reportDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1)).toISOString().slice(0, 10);

  // ---- Guild groups
  const groups: GuildGroup[] = [];
  for (const gid of dreamGuildIds) {
    const cfg = cfgs.get(gid);
    const g = guildMap.get(gid);
    if (!cfg || !g) continue;
    const chars = characters.filter((c) => inGuild(c) === gid);
    const ids = new Set(chars.map((c) => c.member_id));
    const gLogs = logs.filter((l) => ids.has(l.member_id) && l.guild_id === gid);
    const exempt = chars.some((c) => c.position === 'LEADER' || c.position === 'DEPUTY');

    // Last met date pooled over the group (report rules)
    let lastMet: string | null = null;
    const perMemberWeeks = new Map<string, Record<string, number>>();
    if (cfg.period === 'weekly') {
      for (const l of gLogs) {
        const w = perMemberWeeks.get(l.member_id) ?? {};
        const k = getISOWeekKey(l.log_date);
        w[k] = (w[k] ?? 0) + gross(l, cfg.depositsOnly);
        perMemberWeeks.set(l.member_id, w);
      }
      const upTo: Record<string, Record<string, number>> = {};
      for (const l of gLogs) {
        if (l.log_date > reportDay) continue;
        const w = (upTo[l.member_id] ??= {});
        const k = getISOWeekKey(l.log_date);
        w[k] = (w[k] ?? 0) + gross(l, cfg.depositsOnly);
      }
      for (const w of Object.values(upTo)) {
        const sun = findLastMetWeek(w, cfg.weeklyReq)?.toISOString().slice(0, 10) ?? null;
        if (sun && (!lastMet || sun > lastMet)) lastMet = sun;
      }
    } else {
      for (const l of gLogs) if (l.log_date <= reportDay && l.met_requirement && (!lastMet || l.log_date > lastMet)) lastMet = l.log_date;
    }
    // Days since join: the earliest-joined character in the group (any of them could have been active)
    const firstSeens = chars.map((c) => memberMap.get(c.member_id)?.first_seen as string | null).filter((x): x is string => !!x);
    const firstSeen = firstSeens.sort()[0];
    const sinceJoin = firstSeen ? Math.max(0, daysBetween(firstSeen, reportDay)) : 999;
    const days = lastMet ? Math.min(Math.max(0, daysBetween(lastMet, reportDay)), sinceJoin) : Math.min(sinceJoin, 999);
    const noReq = cfg.period === 'daily' ? cfg.dailyReq <= 0 : cfg.weeklyReq <= 0;

    const wk = getISOWeekKey(checkedDay);
    const members = chars.map((c) => {
      const own = gLogs.filter((l) => l.member_id === c.member_id);
      const bank = (bankRows ?? []).find((b) => b.member_id === c.member_id && b.guild_id === gid);
      if (cfg.period === 'weekly') {
        const total = own.filter((l) => l.log_date <= checkedDay && getISOWeekKey(l.log_date) === wk).reduce((s, l) => s + gross(l, cfg.depositsOnly), 0);
        return { member_id: c.member_id, ign: c.ign, contributed: total, met: total >= cfg.weeklyReq, bank_balance: null };
      }
      const day = own.find((l) => l.log_date === checkedDay);
      return {
        member_id: c.member_id,
        ign: c.ign,
        contributed: day ? gross(day) : 0,
        met: !!day?.met_requirement,
        bank_balance: cfg.overflow ? Number(bank?.balance ?? 0) : null,
      };
    });

    // Group streak: a day/week counts when any character in the group met it
    let streak: GuildGroup['streak'];
    if (cfg.period === 'weekly') {
      const metWeeks = new Set<string>();
      perMemberWeeks.forEach((w) => Object.entries(w).forEach(([k, v]) => v >= cfg.weeklyReq && metWeeks.add(k)));
      streak = weekStreak(metWeeks, today);
    } else {
      streak = dayStreak(new Set(gLogs.filter((l) => l.met_requirement).map((l) => l.log_date)), today, checkedDay);
    }

    groups.push({
      guild_id: gid,
      guild_name: g.name,
      guild_nickname: g.nickname,
      period: cfg.period,
      required: cfg.period === 'weekly' ? cfg.weeklyReq : cfg.dailyReq,
      deposits_only: cfg.depositsOnly,
      is_assault: !!g.is_assault,
      raids: g.is_assault ? [] : guildRaids(cfg.settings, g.min_level),
      members,
      met: noReq || members.some((m) => m.met),
      days_inactive: days,
      last_met: lastMet,
      warning_level: exempt || noReq ? 'safe' : getWarningInfo(days, cfg.period).warning_level,
      exempt,
      week_end: cfg.period === 'weekly' ? getWeekSunday(wk) : undefined,
      streak,
    });
  }
  groups.sort((a, b) => (guildMap.get(a.guild_id)?.display_order ?? 99) - (guildMap.get(b.guild_id)?.display_order ?? 99));

  const scopeGroups = scope === 'group' ? groups.filter((g) => g.guild_id === scopeGuild) : scope === 'account' ? groups : [];
  const worst = scopeGroups.reduce<GuildGroup | null>((w, g) => (!w || sev[g.warning_level] > sev[w.warning_level] ? g : w), null);
  const status = {
    warning_level: worst?.warning_level ?? ('safe' as WarningLevel),
    exempt: scopeGroups.length > 0 && scopeGroups.every((g) => g.exempt),
    has_requirement: scopeGroups.length > 0,
  };

  // ---- Logs in scope: group scope = only that guild's logs for its characters
  const scopeLogs = logs.filter((l) => scopeIds.has(l.member_id) && (scope !== 'group' || l.guild_id === scopeGuild));

  // ---- Tiles. Days count once per calendar day even with several characters.
  const cutoff30 = addDays(today, -30);
  const tiles = {
    lifetime_raids: 0,
    lifetime_gold: 0,
    days_met: 0,
    days_logged: 0,
    gold_30d: 0,
    raids_30d: 0,
    assault_kills: 0,
    assault_experience: 0,
    assault_runs: 0,
  };
  const loggedDays = new Set<string>();
  const metDays = new Set<string>();
  for (const l of scopeLogs) {
    tiles.lifetime_raids += l.raids ?? 0;
    tiles.lifetime_gold += gross(l);
    loggedDays.add(l.log_date);
    if (l.met_requirement) metDays.add(l.log_date);
    if (l.log_date > cutoff30) {
      tiles.gold_30d += gross(l);
      tiles.raids_30d += l.raids ?? 0;
    }
  }
  tiles.days_logged = loggedDays.size;
  tiles.days_met = metDays.size;

  const streak = scope === 'character' ? dayStreak(metDays, today, checkedDay) : null;

  // ---- Heatmap: last 53 weeks, best day across scope
  const dayLevel = new Map<string, 0 | 1 | 2 | 3>();
  for (const l of scopeLogs) {
    const g = gross(l);
    const req = (l.guild_id && cfgs.get(l.guild_id)?.dailyReq) || 5000;
    const lvl: 0 | 1 | 2 | 3 = l.met_requirement ? (g >= req * 2 ? 3 : 2) : g > 0 || (l.raids ?? 0) > 0 ? 1 : 0;
    if (lvl > (dayLevel.get(l.log_date) ?? 0)) dayLevel.set(l.log_date, lvl);
  }
  const heatmap: MeSummary['heatmap'] = [];
  for (let i = 370; i >= 0; i--) {
    const date = addDays(today, -i);
    heatmap.push({ date, level: dayLevel.get(date) ?? 0 });
  }

  // ---- Guild journey per character in scope (member_guild_history is not maintained)
  const journey: MeSummary['journey'] = [];
  for (const c of scopeChars) {
    const per = new Map<string, { from: string; to: string; days: number }>();
    for (const l of logs) {
      if (l.member_id !== c.member_id || !l.guild_id) continue;
      const j = per.get(l.guild_id);
      if (!j) per.set(l.guild_id, { from: l.log_date, to: l.log_date, days: 1 });
      else {
        if (l.log_date < j.from) j.from = l.log_date;
        if (l.log_date > j.to) j.to = l.log_date;
        j.days++;
      }
    }
    const cur = inGuild(c);
    if (cur && !per.has(cur)) per.set(cur, { from: (memberMap.get(c.member_id)?.first_seen as string | null) ?? today, to: today, days: 0 });
    per.forEach((j, gid) =>
      journey.push({
        member_id: c.member_id,
        ign: c.ign,
        guild_id: gid,
        name: guildMap.get(gid)?.name ?? `Guild ${gid}`,
        from: j.from,
        to: j.to,
        days_logged: j.days,
        current: cur === gid,
      })
    );
  }
  journey.sort((a, b) => a.ign.localeCompare(b.ign) || a.from.localeCompare(b.from));

  // ---- Per-character raids + move-up nudge (moving guild is per character, by CL)
  const ladder = guilds
    .filter((g) => g.is_active !== false && !g.is_assault && g.min_level != null)
    .sort((a, b) => (a.min_level ?? 0) - (b.min_level ?? 0) || (a.display_order ?? 0) - (b.display_order ?? 0));
  const nudgeFor = (c: AccountCharacter, cl: number | null): Nudge | null => {
    const gid = inGuild(c);
    if (gid === ASSAULT_TOP_GUILD) return null;
    if (gid === ASSAULT_ENTRY_GUILD) {
      const di = guildMap.get(ASSAULT_TOP_GUILD);
      if (!di) return null;
      return { kind: 'assault', guild_name: di.name, min_level: ASSAULT_TOP_MIN_CL, levels_needed: Math.max(0, ASSAULT_TOP_MIN_CL - (cl ?? 0)) };
    }
    if (cl == null) return null;
    const curMin = gid ? guildMap.get(gid)?.min_level ?? -1 : -1;
    const higher = ladder.filter((g) => (g.min_level ?? 0) > curMin);
    const eligible = higher.filter((g) => cl >= (g.min_level ?? 0));
    if (eligible.length) {
      const topMin = eligible[eligible.length - 1].min_level;
      const g = eligible.find((x) => x.min_level === topMin)!;
      return { kind: 'eligible', guild_name: g.name, min_level: g.min_level ?? 0, levels_needed: 0 };
    }
    if (higher.length) return { kind: 'next', guild_name: higher[0].name, min_level: higher[0].min_level ?? 0, levels_needed: (higher[0].min_level ?? 0) - cl };
    // Top of the raid ladder: past here it's assaults, not a higher raid.
    const de = guildMap.get(ASSAULT_ENTRY_GUILD);
    if (de && de.is_active !== false) {
      return { kind: 'assault_entry', guild_name: de.name, min_level: 1, levels_needed: 0 };
    }
    return null;
  };
  const card = (c: AccountCharacter): CharacterCard => {
    const cl = combatLevels.get(c.member_id) ?? null;
    return {
      ...c,
      group_id: inGuild(c),
      last_seen: (memberMap.get(c.member_id)?.last_seen as string | null) ?? null,
      combat_level: cl,
      best_raid: cl ? bestRaidFor(cl) : null,
      nudge: nudgeFor(c, cl),
    };
  };
  const cards = characters.map(card);

  // ---- Assault (scope characters, by IdleMMO character id)
  const scopeMembers = Array.from(scopeIds).map((id) => memberMap.get(id)).filter(Boolean);
  const charIds = scopeMembers.map((m) => m!.character_id as number | null).filter((x): x is number => !!x);
  const hashedNoId = scopeMembers.filter((m) => !m!.character_id && m!.hashed_id).map((m) => m!.hashed_id as string);
  type Contrib = { kills: number; experience: number; character_name: string; run: { zone_name: string; starts_at: string; guild_id: string } | null };
  const sel = 'kills, experience, character_name, run:assault_runs(zone_name, starts_at, guild_id)';
  const [byId, byHash] = await Promise.all([
    charIds.length ? supabase.from('assault_contributions').select(sel).in('character_id', charIds).limit(2000) : { data: [] },
    hashedNoId.length ? supabase.from('assault_contributions').select(sel).in('character_hashed_id', hashedNoId).limit(2000) : { data: [] },
  ]);
  let contribs = [...((byId.data ?? []) as unknown as Contrib[]), ...((byHash.data ?? []) as unknown as Contrib[])];
  if (scope === 'group') contribs = contribs.filter((c) => c.run?.guild_id === scopeGuild);
  for (const c of contribs) {
    tiles.assault_kills += Number(c.kills ?? 0);
    tiles.assault_experience += Number(c.experience ?? 0);
  }
  tiles.assault_runs = contribs.length;

  // ---- Warnings (whole account; the page filters for group scope)
  const warnings = (warningRows ?? []).map((w) => ({
    id: w.id as string,
    ign: ignOf.get(w.member_id as string) ?? '?',
    guild_nickname: guildMap.get(w.guild_id as string)?.nickname ?? null,
    guild_id: w.guild_id as string,
    member_id: w.member_id as string,
    warning_level: w.warning_level as string,
    reason: w.reason as string | null,
    is_auto: !!w.is_auto,
    created_at: w.created_at as string,
  }));
  const scopeWarnings = warnings.filter((w) =>
    scope === 'account' ? true : scope === 'group' ? w.guild_id === scopeGuild && scopeIds.has(w.member_id) : scopeIds.has(w.member_id)
  );

  // ---- Activity feed. Same-day logs of several characters in one guild merge into one entry.
  const multi = scopeIds.size > 1;
  const feed: FeedItem[] = [];
  const dayGuild = new Map<string, LogRow[]>();
  for (const l of scopeLogs) {
    const k = `${l.log_date}|${l.guild_id ?? ''}`;
    const arr = dayGuild.get(k) ?? [];
    arr.push(l);
    dayGuild.set(k, arr);
  }
  const dayEntries = Array.from(dayGuild.entries()).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 14);
  for (const [k, ls] of dayEntries) {
    const [date, gid] = k.split('|');
    const met = ls.some((l) => l.met_requirement);
    const unchecked = date > checkedDay;
    const who = ls
      .filter((l) => gross(l) > 0 || (l.raids ?? 0) > 0 || ls.length === 1)
      .map((l) => {
        const parts = [`${gross(l).toLocaleString('en-US')} gold`];
        if (l.raids) parts.push(`${l.raids} raid${l.raids === 1 ? '' : 's'}`);
        if (l.bank_used) parts.push(`${Number(l.bank_used).toLocaleString('en-US')} from bank`);
        return `${multi ? `${ignOf.get(l.member_id)} ` : ''}${parts.join(', ')}`;
      });
    feed.push({
      at: date,
      kind: 'day',
      title: `${unchecked ? 'Not checked yet' : met ? 'Requirement met' : 'Requirement missed'}${gid ? ` · ${guildMap.get(gid)?.nickname ?? ''}` : ''}`,
      detail: who.join(' · '),
      tone: unchecked ? 'info' : met ? 'good' : 'warn',
    });
  }
  for (const w of scopeWarnings.slice(0, 10)) {
    feed.push({
      at: w.created_at,
      kind: 'warning',
      title: w.warning_level === 'kick' ? 'Kick notice' : `Warning ${w.warning_level === 'warn2' ? '2' : '1'}`,
      detail: `${w.ign}${w.guild_nickname ? ` · ${w.guild_nickname}` : ''}${w.reason ? ` · ${w.reason}` : ''}`,
      tone: 'bad',
    });
  }
  for (const j of journey) {
    if (scope === 'group' && j.guild_id !== scopeGuild) continue;
    feed.push({ at: j.from, kind: 'join', title: `${j.ign} joined ${j.name}`, tone: 'info' });
  }
  for (const c of contribs) {
    if (!c.run) continue;
    feed.push({
      at: c.run.starts_at,
      kind: 'assault',
      title: `${multi ? `${c.character_name}: ` : ''}Assault on ${c.run.zone_name}`,
      detail: `${Number(c.kills).toLocaleString('en-US')} kills · ${Number(c.experience).toLocaleString('en-US')} exp`,
      tone: 'info',
    });
  }
  feed.sort((a, b) => b.at.localeCompare(a.at));

  const scopeGroup = scope === 'group' ? groups.find((g) => g.guild_id === scopeGuild) : undefined;
  return {
    claimed: true,
    scope,
    selected: {
      guild_id: scopeGuild,
      member_id: scope === 'character' ? picked!.member_id : null,
      label: scopeGroup ? scopeGroup.guild_name : scope === 'character' ? picked!.ign : 'Whole account',
    },
    main: card(main),
    tiles,
    check: { checked_day: checkedDay, next_check_at: nextCheckAt(now) },
    groups: scope === 'account' ? groups : scopeGroups,
    switcher: [
      ...groups.map((g) => ({
        guild_id: g.guild_id,
        member_id: null,
        label: `${g.guild_nickname ?? g.guild_name}${g.members.length > 1 ? ` · ${g.members.length} chars` : ''}`,
      })),
      ...characters.filter((c) => !inGuild(c)).map((c) => ({ guild_id: null, member_id: c.member_id, label: c.ign })),
    ],
    status,
    streak,
    heatmap,
    feed: feed.slice(0, 25),
    journey,
    characters: cards,
    warnings: scopeWarnings.map(({ guild_id: _g, member_id: _m, ...w }) => w),
  };
}
