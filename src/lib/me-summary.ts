/**
 * Personal dashboard data for /me.
 *
 * Everything is computed for one "focus" character (the claimed main by default,
 * or any character in the user's account bundle). Alts and warnings cover the
 * whole bundle. Inactivity mirrors /api/reports/inactivity so staff and member
 * see the same number.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAccountCharacters, type AccountCharacter } from '@/lib/account-service';
import { DAY_BOUNDARY_OFFSET_MINUTES } from '@/lib/activity-processor';
import {
  findLastMetWeek,
  getISOWeekKey,
  getWarningInfo,
  getWeekSunday,
  type RequirementPeriod,
  type WarningLevel,
} from '@/lib/warning-calculator';

const DAY_MS = 86_400_000;

interface LogRow {
  log_date: string;
  guild_id: string | null;
  raids: number | null;
  gold_donated: number | null;
  deposits_gold: number | null;
  met_requirement: boolean | null;
  bank_used: number | null;
  bank_balance_after: number | null;
}

interface GuildRow {
  id: string;
  name: string;
  nickname: string | null;
  min_level: number | null;
  display_order: number | null;
  is_active: boolean | null;
}

export interface FeedItem {
  at: string; // ISO date or timestamp, sortable
  kind: 'day' | 'warning' | 'join' | 'assault';
  title: string;
  detail?: string;
  tone: 'good' | 'bad' | 'warn' | 'info';
}

export interface MeSummary {
  claimed: true;
  focus: {
    member_id: string;
    ign: string;
    avatar_url: string | null;
    class: string | null;
    total_level: number | null;
    position: string | null;
    guild_id: string | null;
    guild_name: string | null;
    guild_nickname: string | null;
    in_dream_guild: boolean;
    first_seen: string | null;
    last_seen: string | null;
  };
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
  requirement: null | {
    period: RequirementPeriod;
    game_day: string;
    resets_at: string;
    required: number;
    contributed: number;
    raids: number;
    met: boolean;
    bank_balance: number;
    overflow_enabled: boolean;
    deposits_only: boolean;
    week_end?: string;
  };
  streak: { current: number; best: number; unit: 'day' | 'week' };
  inactivity: null | {
    days_inactive: number;
    warning_level: WarningLevel;
    exempt: boolean;
    last_met: string | null;
  };
  heatmap: { date: string; level: 0 | 1 | 2 | 3 }[];
  feed: FeedItem[];
  journey: { guild_id: string; name: string; nickname: string | null; from: string; to: string; days_logged: number; current: boolean }[];
  nudge: null | {
    kind: 'eligible' | 'next';
    guild_name: string;
    guild_nickname: string | null;
    min_level: number;
    levels_needed: number;
  };
  alts: (AccountCharacter & { last_seen: string | null; is_focus: boolean })[];
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

async function fetchLogs(supabase: SupabaseClient, memberIds: string[]): Promise<(LogRow & { member_id: string })[]> {
  const out: (LogRow & { member_id: string })[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase
      .from('daily_logs')
      .select('member_id, log_date, guild_id, raids, gold_donated, deposits_gold, met_requirement, bank_used, bank_balance_after')
      .in('member_id', memberIds)
      .order('log_date', { ascending: false })
      .range(from, from + page - 1);
    if (error || !data) break;
    out.push(...(data as (LogRow & { member_id: string })[]));
    if (data.length < page) break;
  }
  return out;
}

const gross = (l: LogRow, depositsOnly = false) =>
  depositsOnly ? Number(l.deposits_gold ?? 0) : Number(l.gold_donated ?? 0) + Number(l.deposits_gold ?? 0);

export async function buildMeSummary(
  userId: string,
  focusMemberId: string | null,
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

  const focusChar =
    characters.find((c) => c.member_id === focusMemberId) ??
    characters.find((c) => c.claimed && c.in_dream_guild) ??
    characters.find((c) => c.in_dream_guild) ??
    characters[0];
  const bundleIds = characters.map((c) => c.member_id);

  const [{ data: memberRows }, { data: guildRows }, logs, { data: warningRows }] = await Promise.all([
    supabase.from('members').select('id, first_seen, last_seen, character_id, hashed_id').in('id', bundleIds),
    supabase.from('guilds').select('id, name, nickname, min_level, display_order, is_active'),
    fetchLogs(supabase, bundleIds),
    supabase
      .from('warnings')
      .select('id, member_id, guild_id, warning_level, reason, is_auto, created_at')
      .in('member_id', bundleIds)
      .order('created_at', { ascending: false })
      .limit(25),
  ]);
  const memberMap = new Map((memberRows ?? []).map((m) => [m.id as string, m]));
  const guilds = (guildRows ?? []) as GuildRow[];
  const guildMap = new Map(guilds.map((g) => [g.id, g]));
  const focusMember = memberMap.get(focusChar.member_id);

  const focusLogs = logs.filter((l) => l.member_id === focusChar.member_id); // newest first
  const today = gameDayOf();

  // ---- Guild config for the focus character's current guild
  const { data: cfg } = focusChar.in_dream_guild && focusChar.guild_id
    ? await supabase.from('guild_config').select('settings').eq('guild_id', focusChar.guild_id).maybeSingle()
    : { data: null };
  const settings = (cfg?.settings ?? {}) as Record<string, unknown>;
  const period: RequirementPeriod = settings.requirement_period === 'weekly' ? 'weekly' : 'daily';
  const dailyReq = Number(settings.donation_requirement ?? 5000);
  const weeklyReq = Number(settings.weekly_donation_requirement ?? 35000);
  const depositsOnly = settings.deposits_only === true;
  const overflowEnabled = settings.overflow_enabled !== false;

  // ---- Tiles
  const cutoff30 = addDays(today, -30);
  const tiles = {
    lifetime_raids: 0,
    lifetime_gold: 0,
    days_met: 0,
    days_logged: focusLogs.length,
    gold_30d: 0,
    raids_30d: 0,
    assault_kills: 0,
    assault_experience: 0,
    assault_runs: 0,
  };
  for (const l of focusLogs) {
    tiles.lifetime_raids += l.raids ?? 0;
    tiles.lifetime_gold += gross(l);
    if (l.met_requirement) tiles.days_met++;
    if (l.log_date > cutoff30) {
      tiles.gold_30d += gross(l);
      tiles.raids_30d += l.raids ?? 0;
    }
  }

  // ---- Requirement (current game day / ISO week)
  let requirement: MeSummary['requirement'] = null;
  if (focusChar.in_dream_guild && focusChar.guild_id) {
    const inGuild = focusLogs.filter((l) => l.guild_id === focusChar.guild_id);
    const todayLog = inGuild.find((l) => l.log_date === today);
    const resets = new Date(addDays(today, 1) + 'T00:00:00Z');
    resets.setUTCMinutes(DAY_BOUNDARY_OFFSET_MINUTES);
    const { data: bank } = await supabase
      .from('member_gold_bank')
      .select('balance')
      .eq('member_id', focusChar.member_id)
      .eq('guild_id', focusChar.guild_id)
      .maybeSingle();
    if (period === 'weekly') {
      const wk = getISOWeekKey(today);
      const weekLogs = inGuild.filter((l) => getISOWeekKey(l.log_date) === wk);
      const contributed = weekLogs.reduce((s, l) => s + gross(l, depositsOnly), 0);
      requirement = {
        period,
        game_day: today,
        resets_at: resets.toISOString(),
        required: weeklyReq,
        contributed,
        raids: weekLogs.reduce((s, l) => s + (l.raids ?? 0), 0),
        met: contributed >= weeklyReq,
        bank_balance: 0,
        overflow_enabled: false,
        deposits_only: depositsOnly,
        week_end: getWeekSunday(wk),
      };
    } else {
      requirement = {
        period,
        game_day: today,
        resets_at: resets.toISOString(),
        required: dailyReq,
        contributed: todayLog ? gross(todayLog) : 0,
        raids: todayLog?.raids ?? 0,
        met: !!todayLog?.met_requirement,
        bank_balance: Number(bank?.balance ?? 0),
        overflow_enabled: overflowEnabled,
        deposits_only: false,
      };
    }
  }

  // ---- Streaks (any guild; the character's history)
  let streak: MeSummary['streak'];
  if (period === 'weekly') {
    const weekly = new Map<string, number>();
    for (const l of focusLogs) {
      const k = getISOWeekKey(l.log_date);
      weekly.set(k, (weekly.get(k) ?? 0) + gross(l, depositsOnly));
    }
    const metWeeks = new Set(Array.from(weekly.entries()).filter(([, v]) => v >= weeklyReq).map(([k]) => k));
    // Walk back from this week; an unfinished current week doesn't break the streak.
    let cur = 0;
    let d = today;
    if (!metWeeks.has(getISOWeekKey(d))) d = addDays(d, -7);
    while (metWeeks.has(getISOWeekKey(d))) {
      cur++;
      d = addDays(d, -7);
    }
    const sorted = Array.from(metWeeks).sort();
    let best = 0;
    let run = 0;
    let prev: string | null = null;
    for (const k of sorted) {
      run = prev && getISOWeekKey(addDays(getWeekSunday(prev), 1)) === k ? run + 1 : 1;
      best = Math.max(best, run);
      prev = k;
    }
    streak = { current: cur, best: Math.max(best, cur), unit: 'week' };
  } else {
    const met = new Set(focusLogs.filter((l) => l.met_requirement).map((l) => l.log_date));
    let cur = 0;
    let d = met.has(today) ? today : addDays(today, -1); // today still in progress
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
    streak = { current: cur, best: Math.max(best, cur), unit: 'day' };
  }

  // ---- Inactivity (same rules as the officer report; pooled over same-guild alts)
  let inactivity: MeSummary['inactivity'] = null;
  if (focusChar.in_dream_guild && focusChar.guild_id) {
    const gid = focusChar.guild_id;
    const sameGuild = characters.filter((c) => c.in_dream_guild && c.guild_id === gid);
    const ids = new Set(sameGuild.map((c) => c.member_id));
    const exempt = sameGuild.some((c) => c.position === 'LEADER' || c.position === 'DEPUTY');
    const now = new Date();
    const checkDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1))
      .toISOString()
      .slice(0, 10);
    const guildLogs = logs.filter((l) => ids.has(l.member_id) && l.guild_id === gid && l.log_date <= checkDay);

    let lastMet: string | null = null;
    if (period === 'weekly') {
      const perMember = new Map<string, Record<string, number>>();
      for (const l of guildLogs) {
        const w = perMember.get(l.member_id) ?? {};
        const k = getISOWeekKey(l.log_date);
        w[k] = (w[k] ?? 0) + gross(l, depositsOnly);
        perMember.set(l.member_id, w);
      }
      perMember.forEach((w) => {
        const sun = findLastMetWeek(w, weeklyReq)?.toISOString().slice(0, 10) ?? null;
        if (sun && (!lastMet || sun > lastMet)) lastMet = sun;
      });
    } else {
      for (const l of guildLogs) {
        if (l.met_requirement && (!lastMet || l.log_date > lastMet)) lastMet = l.log_date;
      }
    }
    const firstSeen = focusMember?.first_seen as string | null | undefined;
    const sinceJoin = firstSeen ? Math.max(0, daysBetween(firstSeen, checkDay)) : 999;
    const days = lastMet ? Math.min(Math.max(0, daysBetween(lastMet, checkDay)), sinceJoin) : Math.min(sinceJoin, 999);
    inactivity = {
      days_inactive: days,
      warning_level: exempt ? 'safe' : getWarningInfo(days, period).warning_level,
      exempt,
      last_met: lastMet,
    };
  }

  // ---- Heatmap: last 53 weeks for the focus character, any guild
  const byDate = new Map(focusLogs.map((l) => [l.log_date, l]));
  const heatmap: MeSummary['heatmap'] = [];
  for (let i = 370; i >= 0; i--) {
    const date = addDays(today, -i);
    const l = byDate.get(date);
    let level: 0 | 1 | 2 | 3 = 0;
    if (l) {
      const g = gross(l);
      if (l.met_requirement) level = g >= dailyReq * 2 ? 3 : 2;
      else if (g > 0 || (l.raids ?? 0) > 0) level = 1;
    }
    heatmap.push({ date, level });
  }

  // ---- Guild journey (from logs; member_guild_history is not maintained)
  const journeyMap = new Map<string, { from: string; to: string; days: number }>();
  for (const l of focusLogs) {
    if (!l.guild_id) continue;
    const j = journeyMap.get(l.guild_id);
    if (!j) journeyMap.set(l.guild_id, { from: l.log_date, to: l.log_date, days: 1 });
    else {
      if (l.log_date < j.from) j.from = l.log_date;
      if (l.log_date > j.to) j.to = l.log_date;
      j.days++;
    }
  }
  if (focusChar.in_dream_guild && focusChar.guild_id && !journeyMap.has(focusChar.guild_id)) {
    const fs = (focusMember?.first_seen as string | null) ?? today;
    journeyMap.set(focusChar.guild_id, { from: fs, to: today, days: 0 });
  }
  const journey = Array.from(journeyMap.entries())
    .map(([gid, j]) => {
      const g = guildMap.get(gid);
      return {
        guild_id: gid,
        name: g?.name ?? `Guild ${gid}`,
        nickname: g?.nickname ?? null,
        from: j.from,
        to: j.to,
        days_logged: j.days,
        current: focusChar.in_dream_guild && focusChar.guild_id === gid,
      };
    })
    .sort((a, b) => a.from.localeCompare(b.from));

  // ---- Move-up nudge
  let nudge: MeSummary['nudge'] = null;
  const level = focusChar.total_level ?? 0;
  const curMin = focusChar.in_dream_guild && focusChar.guild_id ? guildMap.get(focusChar.guild_id)?.min_level ?? 0 : -1;
  const higher = guilds
    .filter((g) => g.is_active !== false && g.min_level != null && g.min_level > curMin)
    .sort((a, b) => (a.min_level ?? 0) - (b.min_level ?? 0));
  const eligible = higher.filter((g) => level >= (g.min_level ?? 0));
  if (eligible.length) {
    const g = eligible[eligible.length - 1];
    nudge = { kind: 'eligible', guild_name: g.name, guild_nickname: g.nickname, min_level: g.min_level ?? 0, levels_needed: 0 };
  } else if (higher.length) {
    const g = higher[0];
    nudge = {
      kind: 'next',
      guild_name: g.name,
      guild_nickname: g.nickname,
      min_level: g.min_level ?? 0,
      levels_needed: (g.min_level ?? 0) - level,
    };
  }

  // ---- Assault (focus character, by IdleMMO character id or hashed id)
  const charId = focusMember?.character_id as number | null | undefined;
  const hashed = focusMember?.hashed_id as string | null | undefined;
  type Contrib = { kills: number; experience: number; run: { zone_name: string; starts_at: string; season_number: number | null } | null };
  let contribs: Contrib[] = [];
  if (charId || hashed) {
    const q = supabase
      .from('assault_contributions')
      .select('kills, experience, run:assault_runs(zone_name, starts_at, season_number)')
      .limit(1000);
    const { data } = charId
      ? await q.eq('character_id', charId)
      : await q.eq('character_hashed_id', hashed as string);
    contribs = (data ?? []) as unknown as Contrib[];
  }
  for (const c of contribs) {
    tiles.assault_kills += Number(c.kills ?? 0);
    tiles.assault_experience += Number(c.experience ?? 0);
  }
  tiles.assault_runs = contribs.length;

  // ---- Warnings (whole bundle)
  const ignOf = new Map(characters.map((c) => [c.member_id, c.ign]));
  const warnings = (warningRows ?? []).map((w) => ({
    id: w.id as string,
    ign: ignOf.get(w.member_id as string) ?? '?',
    guild_nickname: guildMap.get(w.guild_id as string)?.nickname ?? null,
    warning_level: w.warning_level as string,
    reason: w.reason as string | null,
    is_auto: !!w.is_auto,
    created_at: w.created_at as string,
  }));

  // ---- Activity feed
  const feed: FeedItem[] = [];
  for (const l of focusLogs.slice(0, 14)) {
    const g = gross(l);
    const parts = [`${g.toLocaleString('en-US')} gold`];
    if (l.raids) parts.push(`${l.raids} raid${l.raids === 1 ? '' : 's'}`);
    if (l.bank_used) parts.push(`${Number(l.bank_used).toLocaleString('en-US')} from bank`);
    feed.push({
      at: l.log_date,
      kind: 'day',
      title: l.met_requirement ? 'Requirement met' : l.log_date === today ? 'Today so far' : 'Requirement missed',
      detail: `${parts.join(' · ')}${l.guild_id ? ` · ${guildMap.get(l.guild_id)?.nickname ?? ''}` : ''}`,
      tone: l.met_requirement ? 'good' : l.log_date === today ? 'info' : 'warn',
    });
  }
  for (const w of warnings.slice(0, 10)) {
    feed.push({
      at: w.created_at,
      kind: 'warning',
      title: w.warning_level === 'kick' ? 'Kick notice' : `Warning ${w.warning_level === 'warn2' ? '2' : '1'}`,
      detail: `${w.ign}${w.guild_nickname ? ` · ${w.guild_nickname}` : ''}${w.reason ? ` · ${w.reason}` : ''}`,
      tone: 'bad',
    });
  }
  for (const j of journey) {
    feed.push({ at: j.from, kind: 'join', title: `Joined ${j.name}`, tone: 'info' });
  }
  for (const c of contribs) {
    if (!c.run) continue;
    feed.push({
      at: c.run.starts_at,
      kind: 'assault',
      title: `Assault: ${c.run.zone_name}`,
      detail: `${Number(c.kills).toLocaleString('en-US')} kills · ${Number(c.experience).toLocaleString('en-US')} exp`,
      tone: 'info',
    });
  }
  feed.sort((a, b) => b.at.localeCompare(a.at));

  return {
    claimed: true,
    focus: {
      member_id: focusChar.member_id,
      ign: focusChar.ign,
      avatar_url: focusChar.avatar_url,
      class: focusChar.class,
      total_level: focusChar.total_level,
      position: focusChar.position,
      guild_id: focusChar.guild_id,
      guild_name: focusChar.guild_name,
      guild_nickname: focusChar.guild_nickname,
      in_dream_guild: focusChar.in_dream_guild,
      first_seen: (focusMember?.first_seen as string | null) ?? null,
      last_seen: (focusMember?.last_seen as string | null) ?? null,
    },
    tiles,
    requirement,
    streak,
    inactivity,
    heatmap,
    feed: feed.slice(0, 25),
    journey,
    nudge,
    alts: characters.map((c) => ({
      ...c,
      last_seen: (memberMap.get(c.member_id)?.last_seen as string | null) ?? null,
      is_focus: c.member_id === focusChar.member_id,
    })),
    warnings,
  };
}
