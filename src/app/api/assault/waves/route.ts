import { requireAccess } from '@/lib/access-server';
import { isResponse } from '@/lib/user-auth';
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { getCurrentSeason } from '@/lib/assault-standings-service';
import { getLocationMeta } from '@/lib/world-locations';

export const dynamic = 'force-dynamic';

interface RunRow {
  id: string; guild_id: string; zone_id: number; zone_name: string; season_number: number | null;
  starts_at: string; ends_at: string; status: string; total_kills: number; total_experience: number;
}
interface ContribRow { run_id: string; character_id: number; character_name: string; total_level: number | null; kills: number; experience: number }

// GET ?season=13  -> every assault wave (per guild + location) with per-member wave XP
export async function GET(req: NextRequest) {
  const gate = await requireAccess(req, 'member');
  if (isResponse(gate)) return gate;
  try {
    const { searchParams } = new URL(req.url);
    const season = parseInt(searchParams.get('season') ?? '', 10) || (await getCurrentSeason());
    const supabase = createAdminClient();

    const { data: runData, error } = await supabase
      .from('assault_runs')
      .select('*')
      .eq('season_number', season)
      .order('starts_at', { ascending: true });
    if (error) throw new Error(error.message);
    const runs = (runData ?? []) as RunRow[];

    const guildIds = Array.from(new Set(runs.map(r => r.guild_id)));
    const { data: gcs } = guildIds.length
      ? await supabase.from('guild_config').select('guild_id, guild_name').in('guild_id', guildIds)
      : { data: [] };
    const guildName = new Map(((gcs ?? []) as { guild_id: string; guild_name: string }[]).map(g => [g.guild_id, g.guild_name]));

    const contribs: ContribRow[] = [];
    const ids = runs.map(r => r.id);
    for (let i = 0; i < ids.length; i += 50) {
      const { data } = await supabase
        .from('assault_contributions')
        .select('run_id, character_id, character_name, total_level, kills, experience')
        .in('run_id', ids.slice(i, i + 50))
        .limit(5000);
      contribs.push(...((data ?? []) as ContribRow[]));
    }

    const meta = await getLocationMeta().catch(() => new Map());
    const counter = new Map<string, number>();
    const waves = runs.map(r => {
      const key = `${r.guild_id}:${r.zone_id}`;
      const wave = (counter.get(key) ?? 0) + 1;
      counter.set(key, wave);
      const members = contribs
        .filter(c => c.run_id === r.id)
        .sort((a, b) => Number(b.experience) - Number(a.experience))
        .map(c => ({ character_id: c.character_id, name: c.character_name, level: c.total_level, kills: Number(c.kills), experience: Number(c.experience) }));
      return {
        id: r.id, wave, guild_id: r.guild_id, guild_name: guildName.get(r.guild_id) ?? r.guild_id,
        zone_id: r.zone_id, zone_name: r.zone_name, image_url: meta.get(r.zone_id)?.image_url ?? null,
        starts_at: r.starts_at, ends_at: r.ends_at, status: r.status,
        total_kills: Number(r.total_kills), total_experience: Number(r.total_experience),
        participants: members.length, members,
      };
    }).reverse(); // newest first

    return NextResponse.json({ season, waves });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
