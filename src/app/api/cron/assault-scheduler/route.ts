import { NextRequest, NextResponse } from 'next/server';
import { postToChannelReturnId, postToChannelRich } from '@/lib/discord-api';
import { rsvpComponents } from '@/lib/assault-rsvp-discord';
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
import { listTrackedGuilds, syncRunForLaunch } from '@/lib/assault-conquest-service';
import { buildTemplateVars, renderTemplate, todayLaunchUnix, utcDateString } from '@/lib/assault-template';
import { runFetchWatchdog } from '@/lib/fetch-runs';
import { createAdminClient } from '@/lib/supabase-server';

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
  const DAY_SPAN = [-3, -2, -1, 0, 1, 2];

  const configs = await listAssaultConfigs();
  const trackedByGuild = new Map((await listTrackedGuilds()).map(t => [t.guild_id, t]));
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
        // Stat syncs catch up for 48h if a tick was missed (idempotent); everything else only within the grace window.
        const grace = s.step_key.startsWith('sync_') ? 48 * 3600 : GRACE_SECONDS;
        if (nowUnix < fireUnix || nowUnix - fireUnix > grace) return false;
        // An interim 13h update is pointless once the 25h final is due
        if (s.step_key === 'sync_13h' && nowUnix >= launchUnix + 1500 * 60) return false;
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
          // Stat-sync steps: pull conquest data and post stats instead of a template message
          if (step.step_key === 'sync_13h' || step.step_key === 'sync_25h') {
            const tracked = trackedByGuild.get(config.guild_id);
            await markSent(config.guild_id, step.id, launchDate);
            const r = tracked
              ? await syncRunForLaunch(tracked, launchUnix, step.step_key === 'sync_25h', { requireActivity: true }).catch(e => ({ ok: false, error: String(e) }))
              : { ok: false, error: 'no conquest config / api key' };
            if (r.ok && 'skipped' in r && r.skipped) {
              // no assault activity for this launch: keep the claim so we don't re-check every tick
              results.push({ guild_id: config.guild_id, step_key: step.step_key, launch_date: launchDate, ok: true, skipped: r.skipped });
            } else if (!r.ok) {
              await releaseSent(config.guild_id, step.id, launchDate); // retry next tick within grace
              results.push({ guild_id: config.guild_id, step_key: step.step_key, launch_date: launchDate, ok: false, error: r.error });
            } else {
              results.push({ guild_id: config.guild_id, step_key: step.step_key, launch_date: launchDate, ok: true });
            }
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
          // Pre-launch notices carry RSVP buttons for this wave (Assault Roster step 6).
          const res = step.offset_minutes < 0
            ? await postToChannelRich(config.announcement_channel_id, { content, components: rsvpComponents(config.guild_id, launchUnix) })
            : await postToChannelReturnId(config.announcement_channel_id, content);
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

  // Activity fetch watchdog piggybacks on this tick: pg_cron keeps firing even when GitHub's cron is late.
  let watchdog: string[] = [];
  try {
    watchdog = (await runFetchWatchdog(createAdminClient(), now)).alerts;
  } catch (e) {
    console.warn('[assault-scheduler] fetch watchdog failed', e);
  }

  return NextResponse.json({ ok: true, minute: currentHHMM, results, watchdog });
}

export async function GET(req: NextRequest) {
  return POST(req);
}
