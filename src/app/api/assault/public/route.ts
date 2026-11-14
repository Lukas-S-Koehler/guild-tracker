import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { nextAssaultLaunchUnix } from '@/lib/assault-service';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = createAdminClient();

  const { data: assaultGuilds } = await supabase
    .from('guilds')
    .select('id')
    .eq('is_assault', true);
  const assaultGuildIds = (assaultGuilds ?? []).map((g: { id: string }) => g.id);

  if (assaultGuildIds.length === 0) {
    return NextResponse.json({ guilds: [] });
  }

  const { data: configs } = await supabase
    .from('assault_configs')
    .select('guild_id, active, launch_time_utc, zone_name, level_range, shrine_info, tracked_zone_id, tracked_zone_key, external_guild_id, weekdays, season_start, season_end, skip_date, paused_until, guild_config:guild_config!inner(guild_name)')
    .in('guild_id', assaultGuildIds)
    .order('guild_id');

  const { data: runs } = await supabase
    .from('assault_runs')
    .select('*')
    .order('starts_at', { ascending: false })
    .limit(50);

  type Config = {
    guild_id: string;
    active: boolean;
    launch_time_utc: string;
    zone_name: string;
    level_range: string;
    shrine_info: string;
    tracked_zone_id: number | null;
    tracked_zone_key: string | null;
    external_guild_id: number | null;
    weekdays: number[] | null;
    season_start: string | null;
    season_end: string | null;
    skip_date: string | null;
    paused_until: string | null;
    guild_config: { guild_name: string } | { guild_name: string }[] | null;
  };

  const out = ((configs as Config[]) ?? []).map((c) => {
    const gc = Array.isArray(c.guild_config) ? c.guild_config[0] : c.guild_config;
    const guildRuns = (runs ?? []).filter((r) => r.guild_id === c.guild_id);
    const lastFinalized = guildRuns.find((r) => r.status === 'finalized');
    const active = guildRuns.find((r) => r.status === 'collecting' && new Date(r.ends_at) > new Date());
    return {
      guild_id: c.guild_id,
      guild_name: gc?.guild_name ?? c.guild_id,
      active: c.active,
      launch_time_utc: c.launch_time_utc,
      zone_name: c.zone_name,
      level_range: c.level_range,
      shrine_info: c.shrine_info,
      tracked_zone_id: c.tracked_zone_id,
      tracked_zone_key: c.tracked_zone_key,
      external_guild_id: c.external_guild_id,
      weekdays: c.weekdays,
      season_start: c.season_start,
      season_end: c.season_end,
      skip_date: c.skip_date,
      paused_until: c.paused_until,
      next_launch_unix: nextAssaultLaunchUnix(c) ?? null,
      active_run: active ?? null,
      last_run: lastFinalized ?? null,
    };
  });

  return NextResponse.json({ guilds: out });
}
