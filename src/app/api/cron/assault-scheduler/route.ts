import { NextRequest, NextResponse } from 'next/server';
import { postToChannelReturnId } from '@/lib/discord-api';
import {
  listAssaultConfigs,
  listSteps,
  isAlreadySent,
  markSent,
  getGuildName,
  nowHHMM,
  computeFireHHMM,
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
  const launchDate = utcDateString(now);

  const results: Array<{ guild_id: string; step_key: string; ok: boolean; error?: string; skipped?: string }> = [];

  const configs = await listAssaultConfigs();
  for (const config of configs) {
    if (!config.announcement_channel_id) continue;
    if (!isAssaultDay(config, now)) continue;

    const steps = await listSteps(config.guild_id);
    const dueSteps = steps.filter(
      s => s.enabled && computeFireHHMM(config.launch_time_utc, s.offset_minutes, now) === currentHHMM
    );
    if (dueSteps.length === 0) continue;

    const guildName = await getGuildName(config.guild_id);
    const launchUnix = todayLaunchUnix(config.launch_time_utc, now);
    const vars = buildTemplateVars(config, guildName, launchUnix);

    for (const step of dueSteps) {
      try {
        if (await isAlreadySent(config.guild_id, step.id, launchDate)) {
          results.push({ guild_id: config.guild_id, step_key: step.step_key, ok: true, skipped: 'already sent' });
          continue;
        }
        const rolePrefix = step.mention_roles.length
          ? step.mention_roles.map(r => `<@&${r}>`).join(' ') + ' '
          : '';
        const content = rolePrefix + renderTemplate(step.message_template, vars);
        const res = await postToChannelReturnId(config.announcement_channel_id, content);
        if (!res.ok) {
          results.push({ guild_id: config.guild_id, step_key: step.step_key, ok: false, error: res.error });
          continue;
        }
        await markSent(config.guild_id, step.id, launchDate, res.messageId);
        results.push({ guild_id: config.guild_id, step_key: step.step_key, ok: true });
      } catch (err) {
        results.push({ guild_id: config.guild_id, step_key: step.step_key, ok: false, error: String(err) });
      }
    }
  }

  return NextResponse.json({ ok: true, minute: currentHHMM, launch_date: launchDate, results });
}

export async function GET(req: NextRequest) {
  return POST(req);
}
