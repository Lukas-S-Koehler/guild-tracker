/**
 * Season recap (Dream Hub step 10, C4).
 *  - Guild recap: one embed per assault guild, posted automatically once its season is over
 *    (assault_configs.season_end has passed) on the live key `assault-recap:<guild>` (mode append).
 *  - Personal recap: built from buildMeAssault (web /me/assault?season=N, Discord `/assault me`).
 * Ranks are within the guild / among Dream players: the in-game shard boards rank every player in
 * a zone, which we can't see, so no shard numbers.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { formatGold } from '@/lib/utils';
import { COLORS, linkRow, medal, ordinal, siteUrl, statFields } from '@/lib/assault-embed';
import { TERRITORY_BOOSTS } from '@/lib/assault-plan-static';
import { getLiveRow, publishLive, type LivePayload, type PublishResult } from '@/lib/discord-live';
import type { MeAssault } from '@/lib/me-assault';
import { getCurrentSeason } from '@/lib/assault-standings-service';

export const assaultRecapKey = (guildId: string) => `assault-recap:${guildId}`;
export const RECAP_PREFIX = 'assault-recap:';
/** Wait this long after season_end before posting (last hourly syncs land). */
const SETTLE_DAYS = 1;
/** Don't post a recap for a season that ended longer ago than this (e.g. bound much later). */
const MAX_LATE_DAYS = 14;

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const place = (i: number) => (i < 3 ? medal(i) : `\`${i + 1}.\``);

async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message);
    const rows = (data as T[]) ?? [];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

/** Latest season this guild has waves in, optionally only waves that started on/before `until` (YYYY-MM-DD). */
export async function latestGuildSeason(supabase: SupabaseClient, guildId: string, until?: string): Promise<number | null> {
  let q = supabase.from('assault_runs').select('season_number').eq('guild_id', guildId).not('season_number', 'is', null);
  if (until) q = q.lte('starts_at', `${until}T23:59:59Z`);
  const { data } = await q.order('season_number', { ascending: false }).limit(1).maybeSingle();
  return (data as { season_number: number } | null)?.season_number ?? null;
}

export async function buildGuildSeasonRecap(supabase: SupabaseClient, guildId: string, season: number): Promise<LivePayload[]> {
  const ext = parseInt(guildId, 10);
  const [{ data: g }, contribs, { data: standings }, runs] = await Promise.all([
    supabase.from('guilds').select('name, nickname').eq('id', guildId).maybeSingle(),
    fetchAll<{ zone_id: number; character_id: number; character_name: string; kills: number; experience: number }>((f, t) =>
      supabase.from('assault_season_contributions').select('zone_id, character_id, character_name, kills, experience')
        .eq('season_number', season).eq('external_guild_id', ext).range(f, t)),
    supabase.from('assault_zone_standings').select('zone_id, zone_name, position, zone_guild_count, experience, kills')
      .eq('season_number', season).eq('external_guild_id', ext).order('position'),
    fetchAll<{ id: string }>((f, t) => supabase.from('assault_runs').select('id').eq('guild_id', guildId).eq('season_number', season).range(f, t)),
  ]);
  const guildName = (g as { name?: string } | null)?.name ?? `Guild ${guildId}`;

  // Per character across zones
  const byChar = new Map<number, { name: string; xp: number; kills: number }>();
  for (const c of contribs) {
    const cur = byChar.get(c.character_id) ?? { name: c.character_name, xp: 0, kills: 0 };
    cur.xp += Number(c.experience);
    cur.kills += Number(c.kills);
    byChar.set(c.character_id, cur);
  }
  const people = Array.from(byChar.values()).filter((p) => p.xp > 0 || p.kills > 0);
  const totalXp = people.reduce((s, p) => s + p.xp, 0);
  const totalKills = people.reduce((s, p) => s + p.kills, 0);

  // Waves attended per character
  const attendance = new Map<string, number>();
  for (let i = 0; i < runs.length; i += 100) {
    const ids = runs.slice(i, i + 100).map((r) => r.id);
    const rows = await fetchAll<{ character_name: string; experience: number }>((f, t) =>
      supabase.from('assault_contributions').select('character_name, experience').in('run_id', ids).range(f, t));
    for (const r of rows) if (Number(r.experience) > 0) attendance.set(r.character_name, (attendance.get(r.character_name) ?? 0) + 1);
  }
  const ironMax = Math.max(0, ...Array.from(attendance.values()));
  const iron = Array.from(attendance.entries()).filter(([, n]) => n === ironMax && n > 0).map(([name]) => name);

  const zoneLines = ((standings ?? []) as { zone_name: string; position: number; zone_guild_count: number; experience: number }[]).map((z) => {
    const boost = z.position <= 10 ? TERRITORY_BOOSTS[z.position - 1] : null;
    return `${z.position <= 3 ? medal(z.position - 1) : '•'} **${z.zone_name}**: ${ordinal(z.position)} of ${z.zone_guild_count} · ${formatGold(Number(z.experience))} XP${boost ? ` · rules next season (+${boost.expMf}% EXP/MF, +${boost.eff}% eff)` : ''}`;
  });

  const topXp = [...people].sort((a, b) => b.xp - a.xp).slice(0, 5);
  const topKills = [...people].sort((a, b) => b.kills - a.kills).slice(0, 3);
  const share = (xp: number) => (totalXp > 0 ? ` · ${Math.round((xp / totalXp) * 100)}%` : '');

  const description = [
    people.length ? `**${guildName}** closed season ${season}. Thank you to everyone who fought!` : `**${guildName}** recorded no assault activity in season ${season}.`,
    '',
    ...(zoneLines.length ? ['__Zones__', ...zoneLines, ''] : []),
    ...(topXp.length ? ['__Top EXP__', ...topXp.map((p, i) => `${place(i)} **${p.name}** · ${formatGold(p.xp)} XP${share(p.xp)}`), ''] : []),
    ...(topKills.length ? ['__Top kills__', ...topKills.map((p, i) => `${place(i)} **${p.name}** · ${fmt(p.kills)} kills`), ''] : []),
    ...(iron.length && runs.length > 1 ? [`🛡️ **Iron attendance:** ${iron.slice(0, 5).join(', ')} (${ironMax} of ${runs.length} waves)`] : []),
  ].join('\n').trim();

  return [
    {
      embeds: [
        {
          title: `🏁 Season ${season} recap · ${guildName}`,
          url: siteUrl(`/me/assault?season=${season}`),
          color: COLORS.purple,
          description: description.slice(0, 4000),
          fields: statFields([
            ['⚡ Total XP', formatGold(totalXp)],
            ['⚔️ Kills', fmt(totalKills)],
            ['👥 Fighters', runs.length ? `${people.length} · ${runs.length} waves` : String(people.length)],
          ]),
          footer: { text: 'Your own recap: /assault me on Discord, or My assault on the website' },
          timestamp: new Date().toISOString(),
        },
      ],
      components: [linkRow(`/me/assault?season=${season}`, 'My season recap')],
      allowed_mentions: { parse: [] },
    },
  ];
}

/** Preview / manual post from Admin → Live messages: the guild's latest season with waves. */
export async function recapPayloadsFor(supabase: SupabaseClient, key: string): Promise<LivePayload[] | null> {
  const guildId = key.slice(RECAP_PREFIX.length);
  let season = await latestGuildSeason(supabase, guildId);
  if (season == null) {
    // No waves recorded (e.g. waves predate wave tracking): latest season with standings.
    const { data } = await supabase.from('assault_zone_standings').select('season_number')
      .eq('external_guild_id', parseInt(guildId, 10)).order('season_number', { ascending: false }).limit(1).maybeSingle();
    season = (data as { season_number: number } | null)?.season_number ?? null;
  }
  return season == null ? null : buildGuildSeasonRecap(supabase, guildId, season);
}

export interface RecapRun {
  guild_id: string;
  season_end: string;
  status: 'posted' | 'already' | 'not-over' | 'too-late' | 'unbound' | 'error';
  season?: number;
  result?: PublishResult;
}

/**
 * Daily (discord-live cron): for each assault guild whose season_end passed at least a day ago and
 * whose recap isn't recorded yet, post the recap once. Unbound/paused keys are retried the next day.
 */
export async function postDueRecaps(supabase: SupabaseClient, now = new Date()): Promise<RecapRun[]> {
  const { data: cfgs } = await supabase.from('assault_configs').select('guild_id, season_end').not('season_end', 'is', null);
  const out: RecapRun[] = [];
  for (const c of (cfgs ?? []) as { guild_id: string; season_end: string }[]) {
    const base = { guild_id: c.guild_id, season_end: c.season_end };
    const settle = new Date(`${c.season_end}T00:00:00Z`);
    settle.setUTCDate(settle.getUTCDate() + SETTLE_DAYS + 1);
    if (now < settle) { out.push({ ...base, status: 'not-over' }); continue; }
    const late = new Date(settle);
    late.setUTCDate(late.getUTCDate() + MAX_LATE_DAYS);
    if (now > late) { out.push({ ...base, status: 'too-late' }); continue; }

    const { data: done, error: doneErr } = await supabase
      .from('assault_season_recaps').select('posted_at').eq('guild_id', c.guild_id).eq('season_end', c.season_end).maybeSingle();
    if (doneErr) { out.push({ ...base, status: 'error', result: { ok: false, status: 'error', message_ids: [], error: `${doneErr.message} (run database/assault-personal.sql?)` } }); continue; }
    if (done) { out.push({ ...base, status: 'already' }); continue; }

    // Season of the guild's last wave before season_end; no waves → the current season is the one ending.
    const season = (await latestGuildSeason(supabase, c.guild_id, c.season_end)) ?? (await getCurrentSeason());
    const key = assaultRecapKey(c.guild_id);
    const row = await getLiveRow(supabase, key);
    if (!row?.enabled) { out.push({ ...base, season, status: 'unbound' }); continue; }

    const result = await publishLive(supabase, key, await buildGuildSeasonRecap(supabase, c.guild_id, season), { mode: 'append', force: true });
    if (result.ok) {
      await supabase.from('assault_season_recaps').insert({
        guild_id: c.guild_id, season_end: c.season_end, season_number: season, message_id: result.message_ids[0] ?? null,
      });
    }
    out.push({ ...base, season, status: result.ok ? 'posted' : 'error', result });
  }
  return out;
}

// ─── Personal recap (Discord `/assault me`) ──────────────────────────────────

export function personalRecapEmbed(a: MeAssault, who: string) {
  const r = a.ranks.season;
  const lines: string[] = [];
  if (!a.zones.length) lines.push(`_No assault contributions in season ${a.season}._`);
  for (const z of a.zones.slice(0, 6)) {
    const pos = z.guild_position ? ` · guild ${ordinal(z.guild_position)}/${z.guild_of}` : '';
    lines.push(`**${z.zone_name}** (${z.guild_name}${pos})`);
    for (const c of z.characters.slice(0, 3)) {
      lines.push(`> ${c.ign}: ${formatGold(c.experience)} XP · ${fmt(c.kills)} kills · #${c.guild_rank_xp}/${c.guild_size} in guild · #${c.dream_rank_xp}/${c.dream_of} Dream`);
    }
  }
  if (a.best_wave) {
    const w = a.best_wave;
    lines.push('', `⭐ Best wave: ${w.guild_name} wave ${w.wave} (${w.zone_name}) · ${formatGold(w.experience)} XP · ${w.share_pct}% of the guild`);
  }
  const next = a.guilds.find((g) => g.next_launch_unix && !a.finished);
  if (next?.next_launch_unix) {
    const cl = next.checklist ? ` · checklist ${next.checklist.done}/${next.checklist.total}` : '';
    lines.push('', `⏰ Next ${next.nickname ?? next.name} launch <t:${next.next_launch_unix}:R>${cl}`);
  }
  return {
    title: `${a.finished ? '🏁' : '⚔️'} ${who} · season ${a.season}${a.finished ? ' recap' : ''}`,
    url: siteUrl(`/me/assault${a.season !== a.current_season ? `?season=${a.season}` : ''}`),
    color: a.finished ? COLORS.purple : COLORS.orange,
    description: lines.join('\n').slice(0, 4000),
    fields: statFields([
      ['⚡ EXP', formatGold(a.totals.experience)],
      ['⚔️ Kills', fmt(a.totals.kills)],
      ['🌊 Waves', a.attendance.waves ? `${a.attendance.attended} / ${a.attendance.waves}` : '—'],
      ['🏅 Dream rank', r ? `#${r.rank} of ${r.of}` : '—'],
      ['📜 All time', a.ranks.all_time ? `#${a.ranks.all_time.rank} of ${a.ranks.all_time.of}` : '—'],
      ['🗺️ Zones', String(a.totals.zones)],
    ]),
    footer: { text: 'Ranks are within your guild / among Dream players · whole account' },
  };
}

