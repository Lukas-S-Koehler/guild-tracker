/**
 * Dream Pass on Discord (step 15): posts to #hall-of-fame (live key `hall-of-fame`, append):
 *  - one launch post (how to earn, last month's champions, this month's top 5),
 *  - season-end post when a season is frozen (top 10 = Season Champions),
 *  - daily level milestones (5 / 10 / 15 / 20) of the running season.
 * Unbound or paused feed = pending items are marked announced so nothing piles up.
 * Discord-facing texts point to /pass, not the website (Discord is core).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getLiveRow, publishLive, textPayloads, type PublishResult } from '@/lib/discord-live';
import { HALL_OF_FAME_KEY } from '@/lib/live-messages';
import { LIFETIME, MAX_LEVEL, PASS_SOURCES, SOURCE_ORDER, currentSeason, seasonLabel, xpForLevel } from '@/lib/dream-pass';
import { PASS_LAUNCH_POST_SETTING } from '@/lib/dream-pass-settings';
import type { Standing } from '@/lib/dream-pass-read';

const MEDALS = ['🥇', '🥈', '🥉'];
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const who = (ign: string, discordId: string | null) => `**${ign}**${discordId ? ` <@${discordId}>` : ''}`;

export function standingLines(standings: Standing[]): string[] {
  return standings.map((s) => `${MEDALS[s.place - 1] ?? `**${s.place}.**`} ${who(s.ign, s.discord_id)} · Lv ${s.level} · ${fmt(s.xp)} XP`);
}

async function mainsOf(supabase: SupabaseClient, memberIds: string[]) {
  if (!memberIds.length) return new Map<string, { ign: string; discord: string | null }>();
  const { data } = await supabase.from('members').select('id, ign, discord_id').in('id', memberIds);
  return new Map((data ?? []).map((m) => [m.id as string, { ign: m.ign as string, discord: (m.discord_id as string | null) ?? null }]));
}

async function topOfSeason(supabase: SupabaseClient, season: string, n: number): Promise<Standing[]> {
  const { data } = await supabase.from('dream_pass_scores').select('member_id, xp, level').eq('season', season).eq('is_main', true).gt('xp', 0).order('xp', { ascending: false }).limit(n);
  const names = await mainsOf(supabase, (data ?? []).map((r) => r.member_id as string));
  return (data ?? []).map((r, i) => ({ place: i + 1, member_id: r.member_id, member_ids: [r.member_id], ign: names.get(r.member_id)?.ign ?? '?', xp: r.xp, level: r.level, discord_id: names.get(r.member_id)?.discord ?? null }));
}

export async function buildLaunchPost(supabase: SupabaseClient): Promise<string[]> {
  const season = currentSeason();
  const [{ data: last }, top] = await Promise.all([
    supabase.from('dream_pass_seasons').select('season, standings').order('season', { ascending: false }).limit(1).maybeSingle(),
    topOfSeason(supabase, season, 5),
  ]);
  const { count } = await supabase.from('dream_pass_scores').select('member_id', { count: 'exact', head: true }).eq('season', LIFETIME).eq('is_main', true).gt('xp', 0);
  return [
    '# 🌌 The Dream Pass is live',
    `Every month is a new **season**: earn XP for what you do for the Dream and climb **${MAX_LEVEL} levels** (${fmt(xpForLevel(MAX_LEVEL))} XP), then ⭐ stars. Your alts count together as one account. Everything you earn also adds to your lifetime **Dream XP**, which sets your rank role.`,
    '',
    '### How to earn',
    ...SOURCE_ORDER.map((k) => `${PASS_SOURCES[k].emoji} **${PASS_SOURCES[k].label}** · ${PASS_SOURCES[k].hint}`),
    '',
    'Assaults are worth the most. The top 10 of each month become **Season Champions** (role until the next season ends).',
    ...(last ? ['', `### 🏆 ${seasonLabel(last.season as string)} champions`, ...standingLines((last.standings ?? []) as Standing[])] : []),
    ...(top.length ? ['', `### 🔥 ${seasonLabel(season)} so far`, ...standingLines(top)] : []),
    '',
    `-# Type **/pass** to see your level. History counts: ${fmt(count ?? 0)} players already have Dream XP from the last months.`,
  ];
}

export function buildSeasonPost(season: string, standings: Standing[], stats: { players: number; maxed: number; total: number }): string[] {
  return [
    `# 🏆 ${seasonLabel(season)} · Dream Pass results`,
    `**${fmt(stats.players)}** players earned **${fmt(stats.total)} XP** together${stats.maxed ? ` · **${stats.maxed}** reached level ${MAX_LEVEL}` : ''}.`,
    '',
    '### Season Champions',
    ...standingLines(standings),
    '',
    '-# The champions hold the Season Champion role until next season ends. A new season has started: **/pass** shows yours.',
  ];
}

export function buildMilestones(rows: Array<{ level: number; ign: string; discord: string | null }>): string[] {
  const levels = Array.from(new Set(rows.map((r) => r.level))).sort((a, b) => b - a);
  return [
    `## 🌌 Dream Pass · ${seasonLabel(currentSeason())}`,
    ...levels.map((l) => `${l === MAX_LEVEL ? '👑' : '⬆️'} **Level ${l}** · ${rows.filter((r) => r.level === l).map((r) => who(r.ign, r.discord)).join(', ')}`),
  ];
}

export interface PassFeedResult {
  launch?: PublishResult | 'skipped';
  seasons: Array<{ season: string; result: PublishResult | 'unbound' }>;
  milestones?: PublishResult | 'nothing' | 'unbound';
}

/** Launch post (once), season-end posts, today's milestones. Call after runDreamPass. */
export async function postDreamPass(supabase: SupabaseClient): Promise<PassFeedResult> {
  const row = await getLiveRow(supabase, HALL_OF_FAME_KEY);
  const live = !!row?.enabled;
  const out: PassFeedResult = { seasons: [] };
  const now = new Date().toISOString();

  if (live) {
    const { data } = await supabase.from('app_settings').select('value').eq('key', PASS_LAUNCH_POST_SETTING).maybeSingle();
    if (!data?.value) {
      out.launch = await publishLive(supabase, HALL_OF_FAME_KEY, textPayloads(await buildLaunchPost(supabase)), { mode: 'append', force: true });
      if (out.launch.ok) await supabase.from('app_settings').upsert({ key: PASS_LAUNCH_POST_SETTING, value: now }, { onConflict: 'key' });
    } else out.launch = 'skipped';
  }

  // Season ends.
  const { data: seasons } = await supabase.from('dream_pass_seasons').select('season, standings').is('announced_at', null).order('season');
  for (const s of seasons ?? []) {
    let result: PublishResult | 'unbound' = 'unbound';
    if (live) {
      const { data: rows } = await supabase.from('dream_pass_scores').select('xp, level').eq('season', s.season).eq('is_main', true).gt('xp', 0);
      const stats = { players: rows?.length ?? 0, maxed: (rows ?? []).filter((r) => r.level >= MAX_LEVEL).length, total: (rows ?? []).reduce((a, r) => a + r.xp, 0) };
      result = await publishLive(supabase, HALL_OF_FAME_KEY, textPayloads(buildSeasonPost(s.season as string, (s.standings ?? []) as Standing[], stats)), { mode: 'append', force: true });
      if (!result.ok) { out.seasons.push({ season: s.season as string, result }); continue; } // retry tomorrow
    }
    await supabase.from('dream_pass_seasons').update({ announced_at: now }).eq('season', s.season);
    out.seasons.push({ season: s.season as string, result });
  }

  // Milestones.
  const { data: pending } = await supabase.from('dream_pass_milestones').select('season, account_key, level, member_id').is('announced_at', null);
  if (!pending?.length) {
    out.milestones = 'nothing';
    return out;
  }
  if (live) {
    // Only the highest new level per person.
    const best = new Map<string, { level: number; member_id: string }>();
    for (const p of pending) {
      const b = best.get(p.account_key);
      if (!b || p.level > b.level) best.set(p.account_key, { level: p.level, member_id: p.member_id });
    }
    const names = await mainsOf(supabase, Array.from(best.values()).map((b) => b.member_id));
    const rows = Array.from(best.values()).map((b) => ({ level: b.level, ign: names.get(b.member_id)?.ign ?? '?', discord: names.get(b.member_id)?.discord ?? null }));
    out.milestones = await publishLive(supabase, HALL_OF_FAME_KEY, textPayloads(buildMilestones(rows)), { mode: 'append', force: true });
    if (!out.milestones.ok) return out;
  } else out.milestones = 'unbound';
  await supabase.from('dream_pass_milestones').update({ announced_at: now }).is('announced_at', null);
  return out;
}
