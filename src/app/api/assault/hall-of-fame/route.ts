import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { getAllFinishes, getAssaultLeaderboard, getTrackedExternalIds } from '@/lib/assault-standings-service';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const ids = await getTrackedExternalIds();
    const supabase = createAdminClient();
    const [finishes, board, { data: bigWave }] = await Promise.all([
      getAllFinishes(ids),
      getAssaultLeaderboard({ merged: false, limit: 10 }),
      supabase.from('assault_runs').select('guild_id, zone_name, season_number, starts_at, total_experience, total_kills')
        .order('total_experience', { ascending: false }).limit(1),
    ]);
    return NextResponse.json({
      finishes,
      assaulters: board.rows,
      biggest_wave: (bigWave ?? [])[0] ?? null,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
