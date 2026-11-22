/**
 * Public guild directory: what a logged-out visitor may see about each Dream guild.
 * guild_config.settings also holds webhooks, channel ids and API keys, so every field
 * here is whitelisted. No per-member data except the leadership (leader/deputies/officers),
 * who are the people a recruit should contact anyway.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { guildRaids } from '@/lib/raids';
import type { FitGuild } from '@/lib/guild-fit';

const BUILDING_NAMES: Record<string, string> = {
  foundation: 'Foundation',
  slot: 'Slot',
  teleportation_beacon: 'Teleportation Beacon',
  mission_table: 'Mission Table',
  raid_planner: 'Raid Planner',
  unity_seal: 'Unity Seal',
  energizing_pool: 'Energizing Pool',
  conquest_banner: 'Conquest Banner',
};
const LEADERSHIP_ORDER: Record<string, number> = { LEADER: 0, DEPUTY: 1, OFFICER: 2 };
const STATS_DAYS = 7;

export interface DirectoryGuild extends FitGuild {
  is_active: boolean;
  display_order: number;
  buildings: string[];
  overflow: { enabled: boolean; limit: number };
  leadership: { ign: string; position: string; avatar_url: string | null }[];
  /** Last STATS_DAYS logged game days. */
  stats: { days: number; gold: number; raids: number; met_rate: number | null; active_members: number };
}

export interface GuildDirectory {
  guilds: DirectoryGuild[];
  network: { active_guilds: number; members: number; gold: number; raids: number; days: number };
}

type Row = Record<string, any>;

async function allRows(q: () => any, page = 1000): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += page) {
    const { data, error } = await q().range(from, from + page - 1);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < page) return out;
  }
}

export async function loadGuildDirectory(supabase: SupabaseClient): Promise<GuildDirectory> {
  const since = new Date(Date.now() - (STATS_DAYS + 1) * 86_400_000).toISOString().slice(0, 10);
  const [guildsRes, cfgRes, members, logs] = await Promise.all([
    supabase.from('guilds').select('id, name, nickname, min_level, display_order, is_active, is_assault').order('display_order'),
    supabase.from('guild_config').select('guild_id, settings'),
    allRows(() => supabase.from('members').select('id, ign, position, avatar_url, current_guild_id').eq('is_active', true).order('id')),
    allRows(() => supabase.from('daily_logs').select('member_id, guild_id, log_date, raids, gold_donated, met_requirement').gte('log_date', since).order('id')),
  ]);
  if (guildsRes.error) throw guildsRes.error;
  const settings = new Map<string, Row>((cfgRes.data ?? []).map((c: Row) => [c.guild_id, c.settings ?? {}]));

  // Keep only the last STATS_DAYS distinct log dates (today may be partial or not yet checked).
  const dates = Array.from(new Set(logs.map((l) => l.log_date as string))).sort().slice(-STATS_DAYS);
  const dateSet = new Set(dates);

  const guilds: DirectoryGuild[] = (guildsRes.data ?? []).map((g: Row) => {
    const s = settings.get(g.id) ?? {};
    const roster = members.filter((m) => m.current_guild_id === g.id);
    const gl = logs.filter((l) => l.guild_id === g.id && dateSet.has(l.log_date));
    const weekly = s.requirement_period === 'weekly';
    return {
      id: g.id,
      name: g.name,
      tag: g.nickname,
      min_level: g.min_level ?? 0,
      is_active: g.is_active !== false,
      is_assault: !!g.is_assault,
      display_order: g.display_order ?? 0,
      raids: g.is_assault ? [] : guildRaids(s, g.min_level),
      requirement: {
        period: weekly ? 'weekly' : 'daily',
        amount: weekly ? s.weekly_donation_requirement ?? 35000 : s.donation_requirement ?? 5000,
      },
      member_count: roster.length,
      buildings: (Array.isArray(s.active_buildings) ? s.active_buildings : [])
        .map((b: string) => BUILDING_NAMES[b])
        .filter(Boolean),
      overflow: { enabled: !!s.overflow_enabled, limit: s.overflow_limit ?? 0 },
      leadership: roster
        .filter((m) => m.position in LEADERSHIP_ORDER)
        .sort((a, b) => LEADERSHIP_ORDER[a.position] - LEADERSHIP_ORDER[b.position] || a.ign.localeCompare(b.ign))
        .map((m) => ({ ign: m.ign, position: m.position, avatar_url: m.avatar_url ?? null })),
      stats: {
        days: dates.length,
        gold: gl.reduce((n, l) => n + (l.gold_donated ?? 0), 0),
        raids: gl.reduce((n, l) => n + (l.raids ?? 0), 0),
        met_rate: gl.length && !weekly ? gl.filter((l) => l.met_requirement).length / gl.length : null,
        active_members: new Set(gl.filter((l) => (l.gold_donated ?? 0) > 0 || (l.raids ?? 0) > 0).map((l) => l.member_id)).size,
      },
    };
  });

  const active = guilds.filter((g) => g.is_active);
  return {
    guilds,
    network: {
      active_guilds: active.length,
      members: active.reduce((n, g) => n + g.member_count, 0),
      gold: active.reduce((n, g) => n + g.stats.gold, 0),
      raids: active.reduce((n, g) => n + g.stats.raids, 0),
      days: dates.length,
    },
  };
}

export function findGuildByTag(dir: GuildDirectory, tag: string): DirectoryGuild | null {
  const t = tag.toLowerCase();
  return dir.guilds.find((g) => g.tag.toLowerCase() === t || g.id === tag) ?? null;
}
