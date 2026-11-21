import { createAdminClient } from '@/lib/supabase-server';
import { IdleMMOApi } from '@/lib/idlemmo-api';
import { postToChannelRich } from '@/lib/discord-api';
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

  const fields = top.slice(0, 10).map((c, i) => ({
    name: `#${i + 1} ${c.name}${c.level ? ` (Lv ${c.level})` : ''}`,
    value: `${c.experience.toLocaleString()} XP · ${c.kills.toLocaleString()} kills`,
    inline: false,
  }));

  const embed = {
    title: `⚔️ ${opts.label ?? 'Assault Complete'} — ${run.zone_name}${opts.wave ? ` · Wave ${opts.wave}` : ''}`,
    description: `**${config.guild_name ?? run.guild_id}** ${final ? 'finished this wave' : 'wave progress so far'}.\n\nWave total: **${run.total_experience.toLocaleString()} XP** · **${run.total_kills.toLocaleString()} kills** · **${top.length}** participants`,
    color: 0xff6b35,
    fields: fields.length > 0 ? fields : [{ name: 'No contributions recorded', value: '—', inline: false }],
    timestamp: new Date().toISOString(),
    footer: { text: `Season ${run.season_number ?? '?'} · ${new Date(run.starts_at).toISOString().slice(0, 10)}` },
  };

  const res = await postToChannelRich(config.announcement_channel_id, { embeds: [embed] });
  if (!res.ok) return null;

  if (res.messageId && final) {
    const supabase = createAdminClient();
    await supabase.from('assault_runs').update({ discord_message_id: res.messageId }).eq('id', run.id);
  }
  return res.messageId ?? null;
}

/** Find the run for a scheduled launch (±3h of launch), discovering it via the conquest view if needed. */
export async function findRunForLaunch(
  config: AssaultConquestConfig,
  launchUnix: number,
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
  opts: { post?: boolean } = {},
): Promise<{ ok: boolean; error?: string; run_id?: string; wave?: number; total_experience?: number; participants?: number }> {
  const run = await findRunForLaunch(config, launchUnix);
  if (!run) return { ok: false, error: 'no assault run found for launch' };
  const { top, wave } = await syncRun(run, config, { final });
  const supabase = createAdminClient();
  const { data: fresh } = await supabase.from('assault_runs').select('*').eq('id', run.id).single();
  if (opts.post !== false) {
    await postFinalizeEmbed((fresh ?? run) as AssaultRunRow, config, top, {
      label: final ? 'Assault Final Stats (25h)' : 'Assault Update (13h)',
      final,
      wave,
    });
  }
  return { ok: true, run_id: run.id, wave, total_experience: Number((fresh as AssaultRunRow | null)?.total_experience ?? 0), participants: top.length };
}
