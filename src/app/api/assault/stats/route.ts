import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

interface ContribRow {
  character_id: number;
  character_name: string;
  total_level: number | null;
  kills: number;
  experience: number;
  run_id: string;
}

interface RunRow {
  id: string;
  guild_id: string;
  season_number: number | null;
  total_kills: number;
  total_experience: number;
  starts_at: string;
  zone_name: string;
  status: string;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const season = searchParams.get('season');
  const guildId = searchParams.get('guild_id');

  const supabase = createAdminClient();

  let runsQuery = supabase
    .from('assault_runs')
    .select('*')
    .eq('status', 'finalized')
    .order('starts_at', { ascending: false });
  if (season) runsQuery = runsQuery.eq('season_number', parseInt(season, 10));
  if (guildId) runsQuery = runsQuery.eq('guild_id', guildId);

  const { data: runs, error: runsErr } = await runsQuery;
  if (runsErr) return NextResponse.json({ error: runsErr.message }, { status: 500 });

  const runIds = ((runs as RunRow[]) ?? []).map((r) => r.id);
  let contributions: ContribRow[] = [];
  if (runIds.length > 0) {
    const { data, error } = await supabase
      .from('assault_contributions')
      .select('character_id, character_name, total_level, kills, experience, run_id')
      .in('run_id', runIds);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    contributions = (data as ContribRow[]) ?? [];
  }

  const runGuildMap = new Map<string, string>();
  for (const r of (runs as RunRow[]) ?? []) runGuildMap.set(r.id, r.guild_id);

  interface Agg { character_id: number; character_name: string; total_level: number | null; kills: number; experience: number; runs: number; guild_id: string; }
  const byChar = new Map<string, Agg>();
  for (const c of contributions) {
    const g = runGuildMap.get(c.run_id) ?? '';
    const key = `${g}:${c.character_id}`;
    const cur = byChar.get(key);
    if (cur) {
      cur.kills += c.kills;
      cur.experience += c.experience;
      cur.runs += 1;
    } else {
      byChar.set(key, {
        character_id: c.character_id,
        character_name: c.character_name,
        total_level: c.total_level,
        kills: c.kills,
        experience: c.experience,
        runs: 1,
        guild_id: g,
      });
    }
  }
  const leaderboard = Array.from(byChar.values()).sort((a, b) => b.kills - a.kills).slice(0, 100);

  const guildTotals: Record<string, { kills: number; experience: number; runs: number }> = {};
  for (const r of (runs as RunRow[]) ?? []) {
    const g = guildTotals[r.guild_id] ??= { kills: 0, experience: 0, runs: 0 };
    g.kills += r.total_kills;
    g.experience += r.total_experience;
    g.runs += 1;
  }

  const seasons = Array.from(new Set(((runs as RunRow[]) ?? []).map((r) => r.season_number).filter((s): s is number => s != null)));

  return NextResponse.json({
    runs: (runs as RunRow[]) ?? [],
    leaderboard,
    guild_totals: guildTotals,
    seasons,
  });
}
