import { NextRequest, NextResponse } from 'next/server';
import { listTrackedGuilds, syncRunForLaunch } from '@/lib/assault-conquest-service';
import { listAssaultConfigs, isAssaultDay } from '@/lib/assault-service';
import { todayLaunchUnix } from '@/lib/assault-template';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// POST /api/admin/assault-wave-sync?guild_id=<local id>[&launch=<ISO start>][&final=0][&post=1]
// (Bearer CRON_SECRET). Records/syncs the most recent scheduled assault wave right now.
// Defaults: latest scheduled launch in the past 8 days, final=1, post=0 (no Discord message).
export async function POST(req: NextRequest) {
  if (!process.env.CRON_SECRET || req.headers.get('Authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const guildId = searchParams.get('guild_id');
  const final = searchParams.get('final') !== '0';
  const post = searchParams.get('post') === '1';

  const tracked = await listTrackedGuilds();
  const targets = guildId ? tracked.filter(t => t.guild_id === guildId) : tracked;
  if (targets.length === 0) return NextResponse.json({ error: 'no matching assault guild' }, { status: 404 });
  const configs = await listAssaultConfigs();

  const now = Date.now();
  const out: unknown[] = [];
  for (const t of targets) {
    const cfg = configs.find(c => c.guild_id === t.guild_id);
    let launchUnix: number | null = null;
    const launchParam = searchParams.get('launch');
    if (launchParam) {
      launchUnix = Math.floor(new Date(launchParam).getTime() / 1000);
    } else if (cfg) {
      for (let d = 0; d >= -8 && launchUnix == null; d--) {
        const day = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + d, 12));
        // ignore pause/skip flags: we want the last scheduled weekday
        if (!isAssaultDay({ ...cfg, active: true, skip_date: null, paused_until: null }, day)) continue;
        const u = todayLaunchUnix(cfg.launch_time_utc, day);
        if (u * 1000 <= now) launchUnix = u;
      }
    }
    if (!launchUnix) { out.push({ guild_id: t.guild_id, error: 'could not determine launch time; pass ?launch=ISO' }); continue; }
    try {
      const r = await syncRunForLaunch(t, launchUnix, final, { post });
      out.push({ guild_id: t.guild_id, launch: new Date(launchUnix * 1000).toISOString(), ...r });
    } catch (e) {
      out.push({ guild_id: t.guild_id, error: String(e) });
    }
  }
  return NextResponse.json({ ok: true, results: out });
}
