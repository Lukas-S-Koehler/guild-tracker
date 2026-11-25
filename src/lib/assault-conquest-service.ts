import { createAdminClient } from '@/lib/supabase-server';
import { IdleMMOApi } from '@/lib/idlemmo-api';
import { nextWaveUnix, rsvpComponents } from '@/lib/assault-rsvp';
import { postToChannelRich } from '@/lib/discord-api';
import { formatGold } from '@/lib/utils';
import { COLORS, podium, statFields, siteUrl, linkRow } from '@/lib/assault-embed';
import { getCurrentSeason, storeZoneStandings, storeSeasonContributions } from '@/lib/assault-standings-service';

export interface AssaultConquestConfig {
  guild_id: string;
  external_guild_id: number | null;
  tracked_zone_id: number | null;
  tracked_zone_key: string | null;
  zone_name: string;
  announcement_channel_id: string | null;
  active: boolean;
  api_key: string | null;
  guild_name: string | null;
}

export async function listTrackedGuilds(): Promise<AssaultConquestConfig[]> {
  const supabase = createAdminClient();
  const { data: ag } = await supabase.from('guilds').select('id').eq('is_assault', true);
  const assaultIds = ((ag ?? []) as { id: string }[]).map(g => g.id);
  if (assaultIds.length === 0) return [];
  const { data, error } = await supabase
    .from('assault_configs')
    .select(`
      guild_id,
      external_guild_id,
      tracked_zone_id,
      tracked_zone_key,
      zone_name,
      announcement_channel_id,
      active,
      guild_config:guild_config!inner(api_key, guild_name)
    `)
    .in('guild_id', assaultIds);
  if (error) throw new Error(error.message);
  type Row = {
    guild_id: string;
    external_guild_id: number | null;
    tracked_zone_id: number | null;
    tracked_zone_key: string | null;
    zone_name: string;
    announcement_channel_id: string | null;
    active: boolean;
    guild_config: { api_key: string | null; guild_name: string | null } | { api_key: string | null; guild_name: string | null }[] | null;
  };
  return ((data as Row[]) ?? []).map((row) => {
    const gc = Array.isArray(row.guild_config) ? row.guild_config[0] : row.guild_config;
    return {
      guild_id: row.guild_id,
      external_guild_id: row.external_guild_id,
      tracked_zone_id: row.tracked_zone_id,
      tracked_zone_key: row.tracked_zone_key,
      zone_name: row.zone_name,
      announcement_channel_id: row.announcement_channel_id,
      active: row.active,
      api_key: gc?.api_key ?? null,
      guild_name: gc?.guild_name ?? null,
    };
  });
}

export interface AssaultRunRow {
  id: string;
  guild_id: string;
  external_guild_id: number;
  zone_id: number;
  zone_key: string;
  zone_name: string;
  season_number: number | null;
  starts_at: string;
  ends_at: string;
  total_kills: number;
  total_experience: number;
  status: 'collecting' | 'finalized';
  snapshot_taken_at: string | null;
  discord_message_id: string | null;
}

export async function upsertRun(row: Omit<AssaultRunRow, 'id' | 'total_kills' | 'total_experience' | 'status' | 'snapshot_taken_at' | 'discord_message_id'>): Promise<AssaultRunRow> {
  const supabase = createAdminClient();
  // Match an existing run (exact or a scheduled-time placeholder within +-3h) and adopt the API's exact times
  const t = new Date(row.starts_at).getTime();
  const { data: near } = await supabase
    .from('assault_runs')
    .select('*')
    .eq('external_guild_id', row.external_guild_id)
    .eq('zone_id', row.zone_id)
    .gte('starts_at', new Date(t - 3 * 3600 * 1000).toISOString())
    .lte('starts_at', new Date(t + 3 * 3600 * 1000).toISOString())
    .order('starts_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (near) {
    const ex = near as AssaultRunRow;
    if (new Date(ex.starts_at).getTime() !== t || new Date(ex.ends_at).getTime() !== new Date(row.ends_at).getTime()) {
      const { data: upd } = await supabase
        .from('assault_runs')
        .update({ starts_at: row.starts_at, ends_at: row.ends_at, updated_at: new Date().toISOString() })
        .eq('id', ex.id)
        .select('*')
        .single();
      return (upd as AssaultRunRow) ?? ex;
    }
    return ex;
  }

  const season = row.season_number ?? (await getCurrentSeason());
  const { data, error } = await supabase
    .from('assault_runs')
    .insert({ ...row, season_number: season })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as AssaultRunRow;
}

export async function listUnfinalizedPastRuns(now: Date): Promise<AssaultRunRow[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('assault_runs')
    .select('*')
    .eq('status', 'collecting')
    .lt('ends_at', now.toISOString());
  if (error) throw new Error(error.message);
  return (data as AssaultRunRow[]) ?? [];
}

function toInt(x: string | number | undefined | null): number {
  if (x == null) return 0;
  if (typeof x === 'number') return x;
  return parseInt(String(x).replace(/,/g, ''), 10) || 0;
}

export async function finalizeRun(
  run: AssaultRunRow,
  config: AssaultConquestConfig,
): Promise<{ contributions: number; top: WaveEntry[]; wave: number }> {
  return syncRun(run, config, { final: true });
}

/** Pull latest contributions into the DB. Only marks the run 'finalized' when opts.final. */
export interface WaveEntry {
  character_id: number;
  name: string;
  level: number | null;
  kills: number;
  experience: number;
}

/** Previous wave (same guild, zone and season) before this run. */
async function previousRun(run: AssaultRunRow): Promise<AssaultRunRow | null> {
  if (run.season_number == null) return null;
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('assault_runs')
    .select('*')
    .eq('guild_id', run.guild_id)
    .eq('zone_id', run.zone_id)
    .eq('season_number', run.season_number)
    .lt('starts_at', run.starts_at)
    .order('starts_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as AssaultRunRow | null) ?? null;
}

/** 1-based wave number within (guild, zone, season), ordered by start. */
export async function waveNumber(run: AssaultRunRow): Promise<number> {
  const supabase = createAdminClient();
  let q = supabase
    .from('assault_runs')
    .select('id', { count: 'exact', head: true })
    .eq('guild_id', run.guild_id)
    .eq('zone_id', run.zone_id)
    .lte('starts_at', run.starts_at);
  if (run.season_number != null) q = q.eq('season_number', run.season_number);
  const { count } = await q;
  return count ?? 1;
}

/**
 * Sync one assault wave.
 * The inspect endpoint returns season-cumulative totals per character, so a wave's
 * contribution = cumulative now - cumulative at the end of the previous wave
 * (stored in assault_run_snapshots). The first wave of a season has a zero baseline.
 */
export async function syncRun(
  run: AssaultRunRow,
  config: AssaultConquestConfig,
  opts: { final: boolean },
): Promise<{ contributions: number; top: WaveEntry[]; wave: number }> {
  if (!config.api_key) throw new Error('missing api_key');
  const api = new IdleMMOApi(config.api_key);
  const inspect = await api.inspectConquestZone(run.zone_id, run.season_number ?? undefined);
  const zone = inspect.zone;

  // Keep season standings + member season totals fresh as a side effect
  try {
    const season = run.season_number ?? (await getCurrentSeason());
    await storeZoneStandings(zone, season);
    await storeSeasonContributions(zone, season, new Set([run.external_guild_id]));
  } catch { /* non-fatal */ }

  const ours = zone.guilds.find(g => g.guild.id === run.external_guild_id);
  const cumulative = ours?.contributions ?? [];

  const supabase = createAdminClient();

  // Baseline = cumulative snapshot at the end of the previous wave
  const baseline = new Map<number, { kills: number; experience: number }>();
  const prev = await previousRun(run);
  if (prev) {
    const { data: snap } = await supabase
      .from('assault_run_snapshots')
      .select('character_id, kills, experience')
      .eq('run_id', prev.id);
    for (const r of (snap ?? []) as { character_id: number; kills: number; experience: number }[]) {
      baseline.set(r.character_id, { kills: Number(r.kills), experience: Number(r.experience) });
    }
    if (baseline.size === 0) {
      // Legacy first wave (recorded before snapshots existed): its stored contributions were cumulative.
      const { data: legacy } = await supabase
        .from('assault_contributions')
        .select('character_id, kills, experience')
        .eq('run_id', prev.id);
      for (const r of (legacy ?? []) as { character_id: number; kills: number; experience: number }[]) {
        baseline.set(r.character_id, { kills: Number(r.kills), experience: Number(r.experience) });
      }
    }
  }

  let totalKills = 0;
  let totalXp = 0;
  const waveRows = cumulative
    .map((c) => {
      const base = baseline.get(c.character.id);
      const kills = Math.max(0, toInt(c.kills) - (base?.kills ?? 0));
      const xp = Math.max(0, toInt(c.experience) - (base?.experience ?? 0));
      return { c, kills, xp };
    })
    .filter(r => r.kills > 0 || r.xp > 0);

  await supabase.from('assault_contributions').delete().eq('run_id', run.id);
  if (waveRows.length > 0) {
    const rows = waveRows.map(({ c, kills, xp }) => {
      totalKills += kills;
      totalXp += xp;
      return {
        run_id: run.id,
        character_id: c.character.id,
        character_hashed_id: c.character.hashed_id,
        character_name: c.character.name,
        total_level: c.character.total_level,
        kills,
        experience: xp,
      };
    });
    const { error } = await supabase.from('assault_contributions').insert(rows);
    if (error) throw new Error(error.message);
  }

  // Save the cumulative snapshot (the next wave's baseline) unless a later wave has
  // already started - then the cumulative numbers include that wave's XP.
  const { count: laterStarted } = await supabase
    .from('assault_runs')
    .select('id', { count: 'exact', head: true })
    .eq('guild_id', run.guild_id)
    .eq('zone_id', run.zone_id)
    .gt('starts_at', run.starts_at)
    .lte('starts_at', new Date().toISOString());
  if (!laterStarted && cumulative.length > 0) {
    await supabase.from('assault_run_snapshots').delete().eq('run_id', run.id);
    const { error } = await supabase.from('assault_run_snapshots').insert(
      cumulative.map(c => ({ run_id: run.id, character_id: c.character.id, kills: toInt(c.kills), experience: toInt(c.experience) })),
    );
    if (error) throw new Error(error.message);
  }

  await supabase
    .from('assault_runs')
    .update({
      status: opts.final ? 'finalized' : run.status,
      snapshot_taken_at: new Date().toISOString(),
      total_kills: totalKills,
      total_experience: totalXp,
      updated_at: new Date().toISOString(),
    })
    .eq('id', run.id);

  const top: WaveEntry[] = waveRows
    .map(({ c, kills, xp }) => ({ character_id: c.character.id, name: c.character.name, level: c.character.total_level, kills, experience: xp }))
    .sort((a, b) => b.experience - a.experience);

  return { contributions: waveRows.length, top, wave: await waveNumber(run) };
}

export async function postFinalizeEmbed(
  run: AssaultRunRow,
  config: AssaultConquestConfig,
  top: WaveEntry[],
  opts: { label?: string; final?: boolean; wave?: number } = {},
): Promise<string | null> {
  const final = opts.final ?? true;
  if (!config.announcement_channel_id) return null;

  const guildName = config.guild_name ?? run.guild_id;
  const n = top.length;
  const totalXp = run.total_experience;
  const avgXp = n > 0 ? Math.round(totalXp / n) : 0;
  const topKiller = [...top].sort((a, b) => b.kills - a.kills)[0];
  const startUnix = Math.floor(new Date(run.starts_at).getTime() / 1000);

  const descLines = [
    `**${guildName}** ${final ? 'finished this wave' : 'wave progress so far'} · launched <t:${startUnix}:R>`,
    '',
    n > 0
      ? podium(top.map(c => ({ name: c.name, level: c.level, experience: c.experience, kills: c.kills })), { max: 10, totalXp })
      : '_No contributions recorded._',
  ];

  const fields = [
    ...statFields([
      ['⚡ Total XP', formatGold(totalXp)],
      ['⚔️ Kills', run.total_kills.toLocaleString()],
      ['👥 Participants', String(n)],
    ]),
    ...(n > 0
      ? statFields([
          ['📊 Avg XP / player', formatGold(avgXp)],
          ...(topKiller && topKiller.name !== top[0].name
            ? [['🎯 Top killer', `${topKiller.name} · ${topKiller.kills.toLocaleString()}`] as [string, string]]
            : []),
        ])
      : []),
  ];

  const embed = {
    title: `⚔️ ${opts.label ?? 'Assault Complete'} — ${run.zone_name}${opts.wave ? ` · Wave ${opts.wave}` : ''}`,
    url: siteUrl('/assault/stats'),
    description: descLines.join('\n').slice(0, 4000),
    color: final ? COLORS.green : COLORS.orange,
    fields,
    timestamp: new Date().toISOString(),
    footer: { text: `Season ${run.season_number ?? '?'} · ${final ? 'Final' : 'Interim'} · full stats on the website` },
  };

  // Final summary opens the RSVP for the next wave, so opt-in members decide early and can hunt for it.
  const nextWave = final ? await nextWaveUnix(config.guild_id).catch(() => null) : null;
  if (nextWave) {
    (embed.fields as { name: string; value: string; inline?: boolean }[]).push({
      name: '📅 Next wave',
      value: `<t:${nextWave}:F> (<t:${nextWave}:R>). Are you in? Answer below so you can start hunting for it.`,
      inline: false,
    });
  }
  const res = await postToChannelRich(config.announcement_channel_id, {
    embeds: [embed],
    components: [linkRow('/assault/stats', 'Full stats & hall of fame'), ...(nextWave ? rsvpComponents(config.guild_id, nextWave) : [])],
  });
  if (!res.ok) return null;

  if (res.messageId && final) {
    const supabase = createAdminClient();
    await supabase.from('assault_runs').update({ discord_message_id: res.messageId }).eq('id', run.id);
  }
  return res.messageId ?? null;
}

/** Find the run for a scheduled launch (±3h of launch), discovering it via the conquest view if needed. */
/**
 * XP the guild has gained in this zone since the end of its previous wave (cumulative now - last snapshot).
 * > 0 means there is unattributed assault activity.
 */
export async function activityDelta(config: AssaultConquestConfig, zoneId: number, launchUnix: number): Promise<number> {
  if (!config.api_key || !config.external_guild_id) return 0;
  const zone = (await new IdleMMOApi(config.api_key).inspectConquestZone(zoneId)).zone;
  const ours = zone.guilds.find(g => g.guild.id === config.external_guild_id);
  const cumulative = (ours?.contributions ?? []).reduce((a, c) => a + toInt(c.experience), 0);

  const supabase = createAdminClient();
  const season = await getCurrentSeason();
  const { data: prev } = await supabase
    .from('assault_runs')
    .select('id')
    .eq('guild_id', config.guild_id)
    .eq('zone_id', zoneId)
    .eq('season_number', season)
    .lt('starts_at', new Date((launchUnix - 3 * 3600) * 1000).toISOString())
    .order('starts_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  let baseline = 0;
  if (prev) {
    const { data: snap } = await supabase.from('assault_run_snapshots').select('experience').eq('run_id', (prev as { id: string }).id);
    baseline = ((snap ?? []) as { experience: number }[]).reduce((a, r) => a + Number(r.experience), 0);
  }
  return cumulative - baseline;
}

export async function findRunForLaunch(
  config: AssaultConquestConfig,
  launchUnix: number,
  opts: { requireActivity?: boolean } = {},
): Promise<AssaultRunRow | null> {
  const supabase = createAdminClient();
  const lo = new Date((launchUnix - 3 * 3600) * 1000).toISOString();
  const hi = new Date((launchUnix + 3 * 3600) * 1000).toISOString();
  const query = () => supabase
    .from('assault_runs')
    .select('*')
    .eq('guild_id', config.guild_id)
    .gte('starts_at', lo)
    .lte('starts_at', hi)
    .match(config.tracked_zone_id ? { zone_id: config.tracked_zone_id } : {})
    .order('starts_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: existing } = await query();
  if (existing) return existing as AssaultRunRow;

  // Discover from conquest view (only works while the assault is still listed as active)
  if (!config.api_key || !config.external_guild_id) return null;
  const view = await new IdleMMOApi(config.api_key).getConquestView();
  const scheduled = async () => {
    // Not listed any more (assault already ended): create the run from the schedule so the wave can still be synced.
    if (!config.tracked_zone_id) return null;
    // Automatic paths only record a wave if there is actually unattributed XP (avoids empty runs for idle guilds)
    if (opts.requireActivity && (await activityDelta(config, config.tracked_zone_id, launchUnix)) <= 0) return null;
    return upsertRun({
      guild_id: config.guild_id,
      external_guild_id: config.external_guild_id!,
      zone_id: config.tracked_zone_id,
      zone_key: config.tracked_zone_key ?? '',
      zone_name: config.zone_name,
      season_number: null,
      starts_at: new Date(launchUnix * 1000).toISOString(),
      ends_at: new Date((launchUnix + 9 * 3600) * 1000).toISOString(),
    });
  };
  for (const zone of Object.values(view.zones)) {
    for (const aa of zone.active_assaults ?? []) {
      if (aa.guild.id !== config.external_guild_id) continue;
      if (config.tracked_zone_id && config.tracked_zone_id !== zone.location.id) continue;
      const t = new Date(aa.starts_at).getTime() / 1000;
      if (t < launchUnix - 3 * 3600 || t > launchUnix + 3 * 3600) continue;
      return upsertRun({
        guild_id: config.guild_id,
        external_guild_id: aa.guild.id,
        zone_id: zone.location.id,
        zone_key: zone.location.key,
        zone_name: zone.location.name,
        season_number: null,
        starts_at: aa.starts_at,
        ends_at: aa.ends_at,
      });
    }
  }
  return scheduled();
}

/** Scheduled stat sync (+13h interim, +25h final). Posts a stats embed to the announcement channel. */
export async function syncRunForLaunch(
  config: AssaultConquestConfig,
  launchUnix: number,
  final: boolean,
  opts: { post?: boolean; requireActivity?: boolean } = {},
): Promise<{ ok: boolean; skipped?: string; error?: string; run_id?: string; wave?: number; total_experience?: number; participants?: number }> {
  const run = await findRunForLaunch(config, launchUnix, { requireActivity: opts.requireActivity });
  if (!run) {
    return opts.requireActivity
      ? { ok: true, skipped: 'no assault activity found for this launch' }
      : { ok: false, error: 'no assault run found for launch' };
  }
  const { top, wave } = await syncRun(run, config, { final });
  const supabase = createAdminClient();
  const { data: fresh } = await supabase.from('assault_runs').select('*').eq('id', run.id).single();
  if (opts.post !== false) {
    await postFinalizeEmbed((fresh ?? run) as AssaultRunRow, config, top, {
      label: final ? 'Assault Final Stats' : 'Assault Update',
      final,
      wave,
    });
  }
  return { ok: true, run_id: run.id, wave, total_experience: Number((fresh as AssaultRunRow | null)?.total_experience ?? 0), participants: top.length };
}


/**
 * Self-healing: for recent scheduled launches whose wave isn't synced yet, record + finalize it.
 * Runs hourly from the collector. Works for the configured location plus any location this guild
 * already has runs in this season. Only acts when there is unattributed XP, and never posts
 * (the scheduler's 25h sync posts). Late-arriving XP simply lands in the next wave's delta.
 */
export async function healWaves(
  configs: Array<AssaultConquestConfig & { launch_time_utc: string; weekdays: number[] | null; season_start: string | null; season_end: string | null }>,
  now: Date,
  isScheduledDay: (c: { weekdays: number[] | null; season_start: string | null; season_end: string | null }, day: Date) => boolean,
  launchUnixFor: (launchTimeUtc: string, day: Date) => number,
): Promise<string[]> {
  const out: string[] = [];
  const supabase = createAdminClient();
  const season = await getCurrentSeason();
  const nowUnix = Math.floor(now.getTime() / 1000);

  for (const cfg of configs) {
    if (!cfg.api_key || !cfg.external_guild_id) continue;
    const zoneIds = new Set<number>();
    if (cfg.tracked_zone_id) zoneIds.add(cfg.tracked_zone_id);
    const { data: zr } = await supabase.from('assault_runs').select('zone_id, zone_name').eq('guild_id', cfg.guild_id).eq('season_number', season);
    const zoneNames = new Map<number, string>();
    for (const r of (zr ?? []) as { zone_id: number; zone_name: string }[]) { zoneIds.add(r.zone_id); zoneNames.set(r.zone_id, r.zone_name); }

    for (let d = 0; d >= -3; d--) {
      const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + d, 12));
      if (!isScheduledDay(cfg, day)) continue;
      const launchUnix = launchUnixFor(cfg.launch_time_utc, day);
      const endsUnix = launchUnix + 9 * 3600;
      if (nowUnix < endsUnix + 2 * 3600 || nowUnix > launchUnix + 72 * 3600) continue;

      for (const zoneId of Array.from(zoneIds)) {
        try {
          const { data: ex } = await supabase
            .from('assault_runs')
            .select('status, snapshot_taken_at')
            .eq('guild_id', cfg.guild_id)
            .eq('zone_id', zoneId)
            .gte('starts_at', new Date((launchUnix - 3 * 3600) * 1000).toISOString())
            .lte('starts_at', new Date((launchUnix + 3 * 3600) * 1000).toISOString())
            .maybeSingle();
          const e = ex as { status: string; snapshot_taken_at: string | null } | null;
          if (e && e.status === 'finalized' && e.snapshot_taken_at && new Date(e.snapshot_taken_at).getTime() / 1000 >= endsUnix + 2 * 3600) continue;
          const zoneCfg = { ...cfg, tracked_zone_id: zoneId, zone_name: zoneNames.get(zoneId) ?? cfg.zone_name };
          const r = await syncRunForLaunch(zoneCfg, launchUnix, true, { post: false, requireActivity: true });
          out.push(`${cfg.guild_id}/zone ${zoneId}/${new Date(launchUnix * 1000).toISOString()}: ${r.skipped ?? (r.ok ? `synced wave ${r.wave}` : r.error)}`);
        } catch (err) {
          out.push(`${cfg.guild_id}/zone ${zoneId}: ${String(err)}`);
        }
      }
    }
  }
  return out;
}
