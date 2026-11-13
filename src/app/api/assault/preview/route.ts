import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, isErrorResponse } from '@/lib/auth-helpers';
import { getAssaultConfig, getStep, getGuildName } from '@/lib/assault-service';
import { buildTemplateVars, renderTemplate, todayLaunchUnix } from '@/lib/assault-template';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req, 'OFFICER');
  if (isErrorResponse(auth)) return auth;
  try {
    const { step_id } = await req.json();
    if (!step_id) return NextResponse.json({ error: 'step_id required' }, { status: 400 });

    const step = await getStep(step_id);
    if (!step || step.guild_id !== auth.guildId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const config = await getAssaultConfig(auth.guildId);
    if (!config) return NextResponse.json({ error: 'No assault config' }, { status: 404 });

    const launchUnix = todayLaunchUnix(config.launch_time_utc);
    const fireUnix = launchUnix + step.offset_minutes * 60;
    const guildName = await getGuildName(auth.guildId);
    const vars = buildTemplateVars(config, guildName, launchUnix);
    const rolePrefix = step.mention_roles.length
      ? step.mention_roles.map(r => `<@&${r}>`).join(' ') + ' '
      : '';
    const rendered = rolePrefix + renderTemplate(step.message_template, vars);

    return NextResponse.json({
      rendered,
      launch_unix: launchUnix,
      fire_unix: fireUnix,
      vars,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
