import { NextRequest, NextResponse } from 'next/server';
import { postToChannelReturnId } from '@/lib/discord-api';
import {
  listAssaultConfigs,
  listSteps,
  isAlreadySent,
  markSent,
  releaseSent,
  setSentMessageId,
  getGuildName,
  nowHHMM,
  isAssaultDay,
} from '@/lib/assault-service';
import { buildTemplateVars, renderTemplate, todayLaunchUnix, utcDateString } from '@/lib/assault-template';

export const dynamic = 'force-dynamic';

// Hit by pg_cron every minute AND a GitHub Actions backup every 5 min.
// A step is "due" once its fire time has passed, within a grace window, so a
// missed tick never drops a ping. Dedup (assault_sent_pings) prevents repeats.
const GRACE_SECONDS = 30 * 60;
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('Authorization');
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const currentHHMM = nowHHMM(now);
  const nowUnix = Math.floor(now.getTime() / 1000);

  const results: Array<{ guild_id: string; step_key: string; launch_date: string; ok: boolean; error?: string; skipped?: string }> = [];

  // A step fires at launch + offset, which may land on a different UTC day than
  // the launch (e.g. -1440 = 24h notice). Check launches from yesterday..+2 days.
  const DAY_SPAN = [-1, 0, 1, 2];

  const configs = await listAssaultConfigs();
  for (const config of configs) {
    if (!config.announcement_channel_id) continue;

    const steps = (await listSteps(config.guild_id)).filter(s => s.enabled);
    if (steps.length === 0) continue;
    const guildName = await getGuildName(config.guild_id);

    for (const dayDelta of DAY_SPAN) {
      const launchDay = new Date(Date.UTC(
        now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + dayDelta, 12, 0, 0
      ));
      if (!isAssaultDay(config, launchDay)) continue;

      const launchDate = utcDateString(launchDay);
      const launchUnix = todayLaunchUnix(config.launch_time_utc, launchDay);
      const dueSteps = steps.filter(s => {
        const fireUnix = launchUnix + s.offset_minutes * 60;
        if (nowUnix < fireUnix || nowUnix - fireUnix > GRACE_SECONDS) return false;
        // pre-launch notices are pointless once the assault has started
        if (s.offset_minutes < 0 && nowUnix > launchUnix) return false;
        return true;
      });
      if (dueSteps.length === 0) continue;

      const vars = buildTemplateVars(config, guildName, launchUnix);

      for (const step of dueSteps) {
        try {
          if (await isAlreadySent(config.guild_id, step.id, launchDate)) {
            results.push({ guild_id: config.guild_id, step_key: step.step_key, launch_date: launchDate, ok: true, skipped: 'already sent' });
            continue;
          }
          const rolePrefix = step.mention_roles.length
            ? step.mention_roles.map(r => `<@&${r}>`).join(' ') + ' '
            : '';
          const content = rolePrefix + renderTemplate(step.message_template, vars);
          // Claim first (unique constraint) so overlapping runs can't double-post.
          try {
            await markSent(config.guild_id, step.id, launchDate);
          } catch {
            results.push({ guild_id: config.guild_id, step_key: step.step_key, launch_date: launchDate, ok: true, skipped: 'claimed by another run' });
            continue;
          }
          const res = await postToChannelReturnId(config.announcement_channel_id, content);
          if (!res.ok) {
            await releaseSent(config.guild_id, step.id, launchDate); // allow retry next tick
            results.push({ guild_id: config.guild_id, step_key: step.step_key, launch_date: launchDate, ok: false, error: res.error });
            continue;
          }
          await setSentMessageId(config.guild_id, step.id, launchDate, res.messageId);
          results.push({ guild_id: config.guild_id, step_key: step.step_key, launch_date: launchDate, ok: true });
        } catch (err) {
          results.push({ guild_id: config.guild_id, step_key: step.step_key, launch_date: launchDate, ok: false, error: String(err) });
        }
      }
    }
  }

  return NextResponse.json({ ok: true, minute: currentHHMM, results });
}

export async function GET(req: NextRequest) {
  return POST(req);
}
