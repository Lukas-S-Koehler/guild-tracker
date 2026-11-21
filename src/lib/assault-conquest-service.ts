import { createAdminClient } from '@/lib/supabase-server';
import { IdleMMOApi, type ConquestContribution } from '@/lib/idlemmo-api';
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
    `);
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
  const { data: existing } = await supabase
    .from('assault_runs')
    .select('*')
    .eq('external_guild_id', row.external_guild_id)
    .eq('zone_id', row.zone_id)
    .eq('starts_at', row.starts_at)
    .maybeSingle();
  if (existing) return existing as AssaultRunRow;

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
): Promise<{ contributions: number; top: ConquestContribution[] }> {
  return syncRun(run, config, { final: true });
}

/** Pull latest contributions into the DB. Only marks the run 'finalized' when opts.final. */
export async function syncRun(
  run: AssaultRunRow,
  config: AssaultConquestConfig,
  opts: { final: boolean },
): Promise<{ contributions: number; top: ConquestContribution[] }> {
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

  // Find our guild entry inside the zone's guilds list
  const ours = zone.guilds.find(g => g.guild.id === run.external_guild_id);
  const contributions = ours?.contributions ?? [];

  const supabase = createAdminClient();

  // Replace prior contrib rows for idempotency
  await supabase.from('assault_contributions').delete().eq('run_id', run.id);

  let totalKills = 0;
  let totalXp = 0;
  if (contributions.length > 0) {
    const rows = contributions.map((c) => {
      const kills = toInt(c.kills);
      const xp = toInt(c.experience);
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

  // If our entry has aggregate totals, prefer those
  if (ours) {
    const aggKills = toInt(ours.kills);
    const aggXp = toInt(ours.experience);
    if (aggKills > 0) totalKills = aggKills;
    if (aggXp > 0) totalXp = aggXp;
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

  const top = [...contributions]
    .sort((a, b) => toInt(b.kills) - toInt(a.kills))
    .slice(0, 10);

  return { contributions: contributions.length, top };
}

export async function postFinalizeEmbed(
  run: AssaultRunRow,
  config: AssaultConquestConfig,
  top: ConquestContribution[],
  opts: { label?: string; final?: boolean } = {},
): Promise<string | null> {
  const final = opts.final ?? true;
  if (!config.announcement_channel_id) return null;

  const fields = top.slice(0, 10).map((c, i) => ({
    name: `#${i + 1} ${c.character.name} (Lv ${c.character.total_level})`,
    value: `${toInt(c.kills).toLocaleString()} kills · ${toInt(c.experience).toLocaleString()} XP`,
    inline: false,
  }));

  const embed = {
    title: `⚔️ ${opts.label ?? 'Assault Complete'} — ${run.zone_name}`,
    description: `**${config.guild_name ?? run.guild_id}** ${final ? 'finished their assault' : 'assault progress so far'}.\n\nTotal: **${run.total_kills.toLocaleString()} kills** · **${run.total_experience.toLocaleString()} XP**`,
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
  return null;
}

/** Scheduled stat sync (+13h interim, +25h final). Posts a stats embed to the announcement channel. */
export async function syncRunForLaunch(
  config: AssaultConquestConfig,
  launchUnix: number,
  final: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const run = await findRunForLaunch(config, launchUnix);
  if (!run) return { ok: false, error: 'no assault run found for launch' };
  const { top } = await syncRun(run, config, { final });
  const supabase = createAdminClient();
  const { data: fresh } = await supabase.from('assault_runs').select('*').eq('id', run.id).single();
  await postFinalizeEmbed((fresh ?? run) as AssaultRunRow, config, top, {
    label: final ? 'Assault Final Stats (25h)' : 'Assault Update (13h)',
    final,
  });
  return { ok: true };
}
