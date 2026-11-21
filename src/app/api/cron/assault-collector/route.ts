import { NextRequest, NextResponse } from 'next/server';
import { IdleMMOApi } from '@/lib/idlemmo-api';
import {
  listTrackedGuilds,
  upsertRun,
  listUnfinalizedPastRuns,
  finalizeRun,
  healWaves,
} from '@/lib/assault-conquest-service';
import { getCurrentSeason, getDreamExternalIds, standingsStale, syncSeason } from '@/lib/assault-standings-service';
import { listAssaultConfigs, isAssaultDay } from '@/lib/assault-service';
import { todayLaunchUnix } from '@/lib/assault-template';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('Authorization');
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
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
          // Any location our guild is actively assaulting is recorded (multi-location assaults)
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

  // 2. Fallback only: quietly finalize runs 2h after they end (XP is up to date by then). The 13h/25h scheduler syncs still
  //    re-sync and post.
  //    (Posting + wave stats are handled by the scheduler's sync steps.)
  const past = await listUnfinalizedPastRuns(new Date(now.getTime() - 2 * 3600 * 1000));
  for (const run of past) {
    const cfg = configByExternal.get(run.external_guild_id);
    if (!cfg) continue;
    try {
      await finalizeRun(run, cfg);
      summary.finalized = (summary.finalized as number) + 1;
    } catch (e) {
      errors.push(`finalize ${run.id}: ${String(e)}`);
    }
  }

  // 2b. Hourly self-heal: record + finalize recent scheduled waves the other paths missed
  if (now.getUTCMinutes() < 5) {
    try {
      const sched = await listAssaultConfigs();
      const merged = tracked
        .map(t => {
          const c = sched.find(x => x.guild_id === t.guild_id);
          return c ? { ...t, launch_time_utc: c.launch_time_utc, weekdays: c.weekdays, season_start: c.season_start, season_end: c.season_end } : null;
        })
        .filter((x): x is NonNullable<typeof x> => x != null);
      summary.healed = await healWaves(
        merged,
        now,
        (c, day) => isAssaultDay({ ...c, active: true, skip_date: null, paused_until: null }, day),
        todayLaunchUnix,
      );
    } catch (e) {
      errors.push(`heal: ${String(e)}`);
    }
  }

  // 3. Hourly: refresh current-season standings (all zones) + member totals
  try {
    const season = await getCurrentSeason();
    if (anyKey && (await standingsStale(season, 55 * 60 * 1000))) {
      const ids = new Set(await getDreamExternalIds());
      const r = await syncSeason(new IdleMMOApi(anyKey), season, season, ids);
      summary.standings = { season, ...r, errors: undefined };
      errors.push(...r.errors);
    }
  } catch (e) {
    errors.push(`standings: ${String(e)}`);
  }

  summary.errors = errors;
  return NextResponse.json({ ok: true, summary });
}
