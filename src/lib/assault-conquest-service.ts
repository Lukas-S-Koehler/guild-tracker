import { createAdminClient } from '@/lib/supabase-server';
import { IdleMMOApi, type ConquestContribution } from '@/lib/idlemmo-api';
import { postToChannelRich } from '@/lib/discord-api';

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

  const { data, error } = await supabase
    .from('assault_runs')
    .insert(row)
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
  if (!config.api_key) throw new Error('missing api_key');
  const api = new IdleMMOApi(config.api_key);
  const inspect = await api.inspectConquestZone(run.zone_id, run.season_number ?? undefined);
  const zone = inspect.zone;

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
      status: 'finalized',
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
): Promise<string | null> {
  if (!config.announcement_channel_id) return null;

  const fields = top.slice(0, 10).map((c, i) => ({
    name: `#${i + 1} ${c.character.name} (Lv ${c.character.total_level})`,
    value: `${toInt(c.kills).toLocaleString()} kills · ${toInt(c.experience).toLocaleString()} XP`,
    inline: false,
  }));

  const embed = {
    title: `⚔️ Assault Complete — ${run.zone_name}`,
    description: `**${config.guild_name ?? run.guild_id}** finished their assault.\n\nTotal: **${run.total_kills.toLocaleString()} kills** · **${run.total_experience.toLocaleString()} XP**`,
    color: 0xff6b35,
    fields: fields.length > 0 ? fields : [{ name: 'No contributions recorded', value: '—', inline: false }],
    timestamp: new Date().toISOString(),
    footer: { text: `Season ${run.season_number ?? '?'} · ${new Date(run.starts_at).toISOString().slice(0, 10)}` },
  };

  const res = await postToChannelRich(config.announcement_channel_id, { embeds: [embed] });
  if (!res.ok) return null;

  if (res.messageId) {
    const supabase = createAdminClient();
    await supabase.from('assault_runs').update({ discord_message_id: res.messageId }).eq('id', run.id);
  }
  return res.messageId ?? null;
}
