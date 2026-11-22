/**
 * Personal dashboard data for /me.
 *
 * Default scope is the whole account (every character in the user's alt bundle).
 * Passing a member_id narrows tiles, streak, heatmap, feed and journey to that one
 * character. The daily check card, alts and warnings always cover the account.
 *
 * Activity is only checked once a day (GitHub daily-activity at 11:48 UTC), so the
 * page reports the last checked game day instead of pretending to be live.
 * Inactivity mirrors /api/reports/inactivity so staff and member see the same number.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAccountCharacters, type AccountCharacter } from '@/lib/account-service';
import { DAY_BOUNDARY_OFFSET_MINUTES } from '@/lib/activity-processor';
import { IdleMMOApi } from '@/lib/idlemmo-api';
import { bestRaidFor, guildRaids, type Raid } from '@/lib/raids';
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
const ASSAULT_TOP_GUILD = '138'; // Dream Invaders: hardcore assaults
const ASSAULT_ENTRY_GUILD = '1184'; // Dream Engineers

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

export interface CheckRow {
  member_id: string;
  ign: string;
  guild_nickname: string | null;
  period: RequirementPeriod;
  required: number;
  /** Daily: gold on the checked day. Weekly: week total as of the last check. */
  contributed: number;
  met: boolean;
  bank_balance: number | null;
  days_inactive: number;
  warning_level: WarningLevel;
  exempt: boolean;
  week_end?: string;
}

export interface CharacterCard extends AccountCharacter {
  last_seen: string | null;
  combat_level: number | null;
  is_focus: boolean;
}

export interface MeSummary {
  claimed: true;
  scope: 'account' | 'character';
  /** Claimed main, or the selected character in character scope. */
  focus: CharacterCard & { first_seen: string | null };
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
  check: { checked_day: string; next_check_at: string; rows: CheckRow[] };
  status: { warning_level: WarningLevel; exempt: boolean };
  streak: { current: number; best: number; unit: 'day' | 'week' };
  heatmap: { date: string; level: 0 | 1 | 2 | 3 }[];
  feed: FeedItem[];
  journey: { guild_id: string; name: string; nickname: string | null; from: string; to: string; days_logged: number; current: boolean }[];
  raids: { guild: Raid[]; best: Raid | null; combat_level: number | null };
  nudge: null | {
    kind: 'eligible' | 'next' | 'assault';
    guild_name: string;
    guild_nickname: string | null;
    min_level: number;
    levels_needed: number;
  };
  alts: CharacterCard[];
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
  const anyKey = Array.from(cfgs.values()).find((c) => c.apiKey)?.apiKey ?? null;

  await Promise.all(
    chars.map(async (c) => {
      const row = rows.get(c.member_id);
      const cached = (row?.combat_level as number | null) ?? null;
      out.set(c.member_id, cached);
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

  const selected = characters.find((c) => c.member_id === focusMemberId) ?? null;
  const scope: MeSummary['scope'] = selected ? 'character' : 'account';
  const main =
    characters.find((c) => c.claimed && c.in_dream_guild) ??
    characters.find((c) => c.in_dream_guild) ??
    characters.find((c) => c.claimed) ??
    characters[0];
  const focusChar = selected ?? main;
  const bundleIds = characters.map((c) => c.member_id);
  const scopeIds = new Set(selected ? [selected.member_id] : bundleIds);
  const dreamGuildIds = Array.from(new Set(characters.filter((c) => c.in_dream_guild && c.guild_id).map((c) => c.guild_id!)));

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
  const focusCfg = focusChar.in_dream_guild && focusChar.guild_id ? cfgs.get(focusChar.guild_id) : undefined;
  const period: RequirementPeriod = focusCfg?.period ?? 'daily';
  const dailyReq = focusCfg?.dailyReq ?? 5000;

  const combatLevels = await loadCombatLevels(supabase, characters, cfgs);

  const today = gameDayOf();
  const checkedDay = addDays(today, -1); // last game day the 11:48 check covered
  const scopeLogs = logs.filter((l) => scopeIds.has(l.member_id)); // newest first

  // ---- Tiles
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

  // ---- Daily check: one row per character in a Dream guild (same rules as the officer report)
  const now = new Date();
  const reportDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1)).toISOString().slice(0, 10);
  const rows: CheckRow[] = [];
  for (const c of characters) {
    if (!c.in_dream_guild || !c.guild_id) continue;
    const cfg = cfgs.get(c.guild_id);
    if (!cfg) continue;
    const gid = c.guild_id;
    const sameGuild = characters.filter((x) => x.in_dream_guild && x.guild_id === gid);
    const groupIds = new Set(sameGuild.map((x) => x.member_id));
    const exempt = sameGuild.some((x) => x.position === 'LEADER' || x.position === 'DEPUTY');
    const groupLogs = logs.filter((l) => groupIds.has(l.member_id) && l.guild_id === gid && l.log_date <= reportDay);
    const own = logs.filter((l) => l.member_id === c.member_id && l.guild_id === gid);

    let lastMet: string | null = null;
    if (cfg.period === 'weekly') {
      const per = new Map<string, Record<string, number>>();
      for (const l of groupLogs) {
        const w = per.get(l.member_id) ?? {};
        const k = getISOWeekKey(l.log_date);
        w[k] = (w[k] ?? 0) + gross(l, cfg.depositsOnly);
        per.set(l.member_id, w);
      }
      per.forEach((w) => {
        const sun = findLastMetWeek(w, cfg.weeklyReq)?.toISOString().slice(0, 10) ?? null;
        if (sun && (!lastMet || sun > lastMet)) lastMet = sun;
      });
    } else {
      for (const l of groupLogs) if (l.met_requirement && (!lastMet || l.log_date > lastMet)) lastMet = l.log_date;
    }
    const firstSeen = memberMap.get(c.member_id)?.first_seen as string | null | undefined;
    const sinceJoin = firstSeen ? Math.max(0, daysBetween(firstSeen, reportDay)) : 999;
    const days = lastMet ? Math.min(Math.max(0, daysBetween(lastMet, reportDay)), sinceJoin) : Math.min(sinceJoin, 999);

    const bank = (bankRows ?? []).find((b) => b.member_id === c.member_id && b.guild_id === gid);
    if (cfg.period === 'weekly') {
      const wk = getISOWeekKey(checkedDay);
      const total = own.filter((l) => getISOWeekKey(l.log_date) === wk && l.log_date <= checkedDay).reduce((s, l) => s + gross(l, cfg.depositsOnly), 0);
      rows.push({
        member_id: c.member_id,
        ign: c.ign,
        guild_nickname: c.guild_nickname,
        period: 'weekly',
        required: cfg.weeklyReq,
        contributed: total,
        met: total >= cfg.weeklyReq,
        bank_balance: null,
        days_inactive: days,
        warning_level: exempt ? 'safe' : getWarningInfo(days, 'weekly').warning_level,
        exempt,
        week_end: getWeekSunday(wk),
      });
    } else {
      const day = own.find((l) => l.log_date === checkedDay);
      rows.push({
        member_id: c.member_id,
        ign: c.ign,
        guild_nickname: c.guild_nickname,
        period: 'daily',
        required: cfg.dailyReq,
        contributed: day ? gross(day) : 0,
        met: cfg.dailyReq <= 0 || !!day?.met_requirement,
        bank_balance: cfg.overflow ? Number(bank?.balance ?? 0) : null,
        days_inactive: days,
        warning_level: exempt ? 'safe' : getWarningInfo(days, 'daily').warning_level,
        exempt,
      });
    }
  }
  const statusRows = selected ? rows.filter((r) => r.member_id === selected.member_id) : rows;
  const worst = statusRows.reduce<CheckRow | null>((w, r) => (!w || sev[r.warning_level] > sev[w.warning_level] ? r : w), null);
  const status = {
    warning_level: worst?.warning_level ?? ('safe' as WarningLevel),
    exempt: statusRows.length > 0 && statusRows.every((r) => r.exempt),
  };

  // ---- Streak (scope; account = any character met)
  let streak: MeSummary['streak'];
  if (period === 'weekly') {
    const weeklyReq = focusCfg?.weeklyReq ?? 35000;
    const weekly = new Map<string, number>();
    for (const l of scopeLogs) {
      const k = getISOWeekKey(l.log_date);
      weekly.set(k, (weekly.get(k) ?? 0) + gross(l, focusCfg?.depositsOnly));
    }
    const metWeeks = new Set(Array.from(weekly.entries()).filter(([, v]) => v >= weeklyReq).map(([k]) => k));
    let cur = 0;
    let d = today;
    if (!metWeeks.has(getISOWeekKey(d))) d = addDays(d, -7); // unfinished week doesn't break it
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
    streak = { current: cur, best: Math.max(best, cur), unit: 'week' };
  } else {
    let cur = 0;
    let d = metDays.has(today) ? today : checkedDay;
    while (metDays.has(d)) {
      cur++;
      d = addDays(d, -1);
    }
    const sorted = Array.from(metDays).sort();
    let best = 0;
    let run = 0;
    for (let i = 0; i < sorted.length; i++) {
      run = i > 0 && daysBetween(sorted[i - 1], sorted[i]) === 1 ? run + 1 : 1;
      best = Math.max(best, run);
    }
    streak = { current: cur, best: Math.max(best, cur), unit: 'day' };
  }

  // ---- Heatmap: last 53 weeks, best day across scope
  const dayLevel = new Map<string, 0 | 1 | 2 | 3>();
  for (const l of scopeLogs) {
    const g = gross(l);
    const req = (l.guild_id && cfgs.get(l.guild_id)?.dailyReq) || dailyReq;
    const lvl: 0 | 1 | 2 | 3 = l.met_requirement ? (g >= req * 2 ? 3 : 2) : g > 0 || (l.raids ?? 0) > 0 ? 1 : 0;
    if (lvl > (dayLevel.get(l.log_date) ?? 0)) dayLevel.set(l.log_date, lvl);
  }
  const heatmap: MeSummary['heatmap'] = [];
  for (let i = 370; i >= 0; i--) {
    const date = addDays(today, -i);
    heatmap.push({ date, level: dayLevel.get(date) ?? 0 });
  }

  // ---- Guild journey (focus character; member_guild_history is not maintained)
  const focusLogs = logs.filter((l) => l.member_id === focusChar.member_id);
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
  const focusMember = memberMap.get(focusChar.member_id);
  if (focusChar.in_dream_guild && focusChar.guild_id && !journeyMap.has(focusChar.guild_id)) {
    journeyMap.set(focusChar.guild_id, { from: (focusMember?.first_seen as string | null) ?? today, to: today, days: 0 });
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

  // ---- Raids + move-up nudge (focus character, by combat level)
  const cl = combatLevels.get(focusChar.member_id) ?? null;
  const curGuild = focusChar.in_dream_guild && focusChar.guild_id ? guildMap.get(focusChar.guild_id) : undefined;
  const raids = {
    guild: curGuild ? guildRaids(focusCfg?.settings, curGuild.min_level) : [],
    best: cl ? bestRaidFor(cl) : null,
    combat_level: cl,
  };

  let nudge: MeSummary['nudge'] = null;
  if (curGuild?.id === ASSAULT_TOP_GUILD) {
    nudge = null; // top of the network
  } else if (curGuild?.id === ASSAULT_ENTRY_GUILD) {
    const di = guildMap.get(ASSAULT_TOP_GUILD);
    if (di) nudge = { kind: 'assault', guild_name: di.name, guild_nickname: di.nickname, min_level: di.min_level ?? 0, levels_needed: 0 };
  } else if (cl != null) {
    // Raid ladder: active non-assault guilds, ranked by min combat level.
    const curMin = curGuild?.min_level ?? -1;
    const higher = guilds
      .filter((g) => g.is_active !== false && !g.is_assault && g.min_level != null && g.min_level > curMin)
      .sort((a, b) => (a.min_level ?? 0) - (b.min_level ?? 0) || (a.display_order ?? 0) - (b.display_order ?? 0));
    const eligible = higher.filter((g) => cl >= (g.min_level ?? 0));
    if (eligible.length) {
      const topMin = eligible[eligible.length - 1].min_level;
      const g = eligible.filter((x) => x.min_level === topMin)[0];
      nudge = { kind: 'eligible', guild_name: g.name, guild_nickname: g.nickname, min_level: g.min_level ?? 0, levels_needed: 0 };
    } else if (higher.length) {
      const g = higher[0];
      nudge = { kind: 'next', guild_name: g.name, guild_nickname: g.nickname, min_level: g.min_level ?? 0, levels_needed: (g.min_level ?? 0) - cl };
    }
  }

  // ---- Assault (scope characters, by IdleMMO character id)
  const scopeMembers = Array.from(scopeIds).map((id) => memberMap.get(id)).filter(Boolean);
  const charIds = scopeMembers.map((m) => m!.character_id as number | null).filter((x): x is number => !!x);
  const hashedNoId = scopeMembers.filter((m) => !m!.character_id && m!.hashed_id).map((m) => m!.hashed_id as string);
  type Contrib = { kills: number; experience: number; character_name: string; run: { zone_name: string; starts_at: string } | null };
  const contribs: Contrib[] = [];
  const sel = 'kills, experience, character_name, run:assault_runs(zone_name, starts_at)';
  const [byId, byHash] = await Promise.all([
    charIds.length ? supabase.from('assault_contributions').select(sel).in('character_id', charIds).limit(2000) : { data: [] },
    hashedNoId.length ? supabase.from('assault_contributions').select(sel).in('character_hashed_id', hashedNoId).limit(2000) : { data: [] },
  ]);
  contribs.push(...((byId.data ?? []) as unknown as Contrib[]), ...((byHash.data ?? []) as unknown as Contrib[]));
  for (const c of contribs) {
    tiles.assault_kills += Number(c.kills ?? 0);
    tiles.assault_experience += Number(c.experience ?? 0);
  }
  tiles.assault_runs = contribs.length;

  // ---- Warnings (whole account)
  const warnings = (warningRows ?? []).map((w) => ({
    id: w.id as string,
    ign: ignOf.get(w.member_id as string) ?? '?',
    guild_nickname: guildMap.get(w.guild_id as string)?.nickname ?? null,
    warning_level: w.warning_level as string,
    reason: w.reason as string | null,
    is_auto: !!w.is_auto,
    created_at: w.created_at as string,
  }));

  // ---- Activity feed (scope)
  const multi = scopeIds.size > 1;
  const feed: FeedItem[] = [];
  for (const l of scopeLogs.slice(0, 20)) {
    const g = gross(l);
    const parts = [`${g.toLocaleString('en-US')} gold`];
    if (l.raids) parts.push(`${l.raids} raid${l.raids === 1 ? '' : 's'}`);
    if (l.bank_used) parts.push(`${Number(l.bank_used).toLocaleString('en-US')} from bank`);
    const unchecked = l.log_date > checkedDay;
    feed.push({
      at: l.log_date,
      kind: 'day',
      title: `${multi ? `${ignOf.get(l.member_id)}: ` : ''}${unchecked ? 'Not checked yet' : l.met_requirement ? 'Requirement met' : 'Requirement missed'}`,
      detail: `${parts.join(' · ')}${l.guild_id ? ` · ${guildMap.get(l.guild_id)?.nickname ?? ''}` : ''}`,
      tone: unchecked ? 'info' : l.met_requirement ? 'good' : 'warn',
    });
  }
  for (const w of warnings.filter((w) => !selected || w.ign === selected.ign).slice(0, 10)) {
    feed.push({
      at: w.created_at,
      kind: 'warning',
      title: w.warning_level === 'kick' ? 'Kick notice' : `Warning ${w.warning_level === 'warn2' ? '2' : '1'}`,
      detail: `${w.ign}${w.guild_nickname ? ` · ${w.guild_nickname}` : ''}${w.reason ? ` · ${w.reason}` : ''}`,
      tone: 'bad',
    });
  }
  for (const j of journey) feed.push({ at: j.from, kind: 'join', title: `${focusChar.ign} joined ${j.name}`, tone: 'info' });
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

  const card = (c: AccountCharacter): CharacterCard => ({
    ...c,
    last_seen: (memberMap.get(c.member_id)?.last_seen as string | null) ?? null,
    combat_level: combatLevels.get(c.member_id) ?? null,
    is_focus: !!selected && c.member_id === selected.member_id,
  });

  return {
    claimed: true,
    scope,
    focus: { ...card(focusChar), first_seen: (focusMember?.first_seen as string | null) ?? null },
    tiles,
    check: { checked_day: checkedDay, next_check_at: nextCheckAt(now), rows },
    status,
    streak,
    heatmap,
    feed: feed.slice(0, 25),
    journey,
    raids,
    nudge,
    alts: characters.map(card),
    warnings,
  };
}
