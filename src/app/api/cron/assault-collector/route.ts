import { NextRequest, NextResponse } from 'next/server';
import { IdleMMOApi } from '@/lib/idlemmo-api';
import { createAdminClient } from '@/lib/supabase-server';
import {
  listTrackedGuilds,
  upsertRun,
  listUnfinalizedPastRuns,
  finalizeRun,
  postFinalizeEmbed,
} from '@/lib/assault-conquest-service';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('Authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const summary: Record<string, unknown> = { discovered: 0, finalized: 0, errors: [] as string[] };
  const errors: string[] = [];

  const tracked = await listTrackedGuilds();
  const configByExternal = new Map<number, typeof tracked[number]>();
  for (const t of tracked) {
    if (t.external_guild_id) configByExternal.set(t.external_guild_id, t);
  }

  // 1. Discover active assaults — use one key for conquest view (any tracked guild's key works)
  const anyKey = tracked.find(t => t.api_key)?.api_key;
  if (anyKey) {
    try {
      const api = new IdleMMOApi(anyKey);
      const view = await api.getConquestView();

      for (const [, zone] of Object.entries(view.zones)) {
        for (const aa of zone.active_assaults ?? []) {
          const cfg = configByExternal.get(aa.guild.id);
          if (!cfg) continue;
          // Only track assaults on the guild's configured zone (consistency rule)
          if (cfg.tracked_zone_id && cfg.tracked_zone_id !== zone.location.id) continue;

          await upsertRun({
            guild_id: cfg.guild_id,
            external_guild_id: aa.guild.id,
            zone_id: zone.location.id,
            zone_key: zone.location.key,
            zone_name: zone.location.name,
            season_number: null,
            starts_at: aa.starts_at,
            ends_at: aa.ends_at,
          });
          summary.discovered = (summary.discovered as number) + 1;
        }
      }
    } catch (e) {
      errors.push(`view: ${String(e)}`);
    }
  }

  // 2. Finalize past-ended runs
  const past = await listUnfinalizedPastRuns(now);
  for (const run of past) {
    const cfg = configByExternal.get(run.external_guild_id);
    if (!cfg) continue;
    try {
      const { top } = await finalizeRun(run, cfg);
      // reload fresh row for accurate totals
      const supabase = createAdminClient();
      const { data: fresh } = await supabase.from('assault_runs').select('*').eq('id', run.id).single();
      if (fresh) await postFinalizeEmbed(fresh as typeof run, cfg, top);
      summary.finalized = (summary.finalized as number) + 1;
    } catch (e) {
      errors.push(`finalize ${run.id}: ${String(e)}`);
    }
  }

  summary.errors = errors;
  return NextResponse.json({ ok: true, summary });
}
