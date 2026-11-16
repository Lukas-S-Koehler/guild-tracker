import { NextRequest, NextResponse } from 'next/server';
import { postToChannelReturnId } from '@/lib/discord-api';
import {
  listAssaultConfigs,
  listSteps,
  isAlreadySent,
  markSent,
  getGuildName,
  nowHHMM,
  isAssaultDay,
} from '@/lib/assault-service';
import { buildTemplateVars, renderTemplate, todayLaunchUnix, utcDateString } from '@/lib/assault-template';

export const dynamic = 'force-dynamic';

// pg_cron hits this every minute.
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('Authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const currentHHMM = nowHHMM(now);
  const nowMinute = Math.floor(now.getTime() / 60000);

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
      const dueSteps = steps.filter(
        s => Math.floor((launchUnix + s.offset_minutes * 60) / 60) === nowMinute
      );
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
          const res = await postToChannelReturnId(config.announcement_channel_id, content);
          if (!res.ok) {
            results.push({ guild_id: config.guild_id, step_key: step.step_key, launch_date: launchDate, ok: false, error: res.error });
            continue;
          }
          await markSent(config.guild_id, step.id, launchDate, res.messageId);
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
