import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { IdleMMOApi } from '@/lib/idlemmo-api';
import { postToChannel } from '@/lib/discord-api';

type PoolStatus = 'DORMANT' | 'ACTIVE_BUT_NOT_APPLIED' | 'ACTIVE_AND_APPLIED';

function isActiveStatus(s: string | undefined | null): boolean {
  return !!s && s.startsWith('ACTIVE');
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('Authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient();

  const { data: configs, error: configsError } = await supabase
    .from('guild_config')
    .select('guild_id, guild_name, api_key, settings')
    .neq('api_key', 'placeholder');

  if (configsError) return NextResponse.json({ error: configsError.message }, { status: 500 });

  const results: { guild: string; status: string }[] = [];

  for (const config of configs ?? []) {
    const guildName: string = config.guild_name ?? config.guild_id;
    const settings = config.settings ?? {};
    const activeBuildings: string[] = settings.active_buildings ?? [];
    const logChannelId: string | undefined = settings.discord_log_channel_id;
    const roleId: string | undefined = settings.energizing_pool_ping_role_id;

    if (!activeBuildings.includes('energizing_pool') || !logChannelId || !roleId || !config.api_key) {
      results.push({ guild: guildName, status: 'skipped' });
      continue;
    }

    try {
      const api = new IdleMMOApi(config.api_key);
      const data = await api.getEnergizingPool(config.guild_id);
      const status = data.energizing_pool.status as PoolStatus;
      const prevStatus: string = settings.energizing_pool_last_status ?? 'DORMANT';

      let action = 'no_change';
      if (isActiveStatus(status) && !isActiveStatus(prevStatus)) {
        const endsAt = data.energizing_pool.ends_at;
        const endsUnix = endsAt ? Math.floor(new Date(endsAt).getTime() / 1000) : null;
        const endsLine = endsUnix ? ` Ends <t:${endsUnix}:R>` : '';
        const effects = data.energizing_pool.effects ?? [];
        const effectsBlock = effects.length
          ? `\n\nEffects:\n${effects.map(e => `• ${e}`).join('\n')}`
          : '';
        const content = `<@&${roleId}> ⚡ **Energizing Pool active!**${endsLine}${effectsBlock}`;

        const post = await postToChannel(logChannelId, content);
        action = post.ok ? 'pinged' : `error:${post.error}`;
      }

      await supabase
        .from('guild_config')
        .update({ settings: { ...settings, energizing_pool_last_status: status } })
        .eq('guild_id', config.guild_id);

      results.push({ guild: guildName, status: action });
    } catch (err) {
      results.push({ guild: guildName, status: `error:${String(err)}` });
    }
  }

  return NextResponse.json({ results });
}
