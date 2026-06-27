import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { IdleMMOApi } from '@/lib/idlemmo-api';
import { postToChannelReturnId, editChannelMessage } from '@/lib/discord-api';

const NUMBER_EMOJIS = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];

function conditionEmoji(pct: number): string {
  if (pct >= 75) return '🟢';
  if (pct >= 50) return '🟡';
  if (pct >= 25) return '🟠';
  return '🔴';
}

function fillEmoji(ratio: number): string {
  if (ratio >= 0.9) return '🟡';
  if (ratio >= 0.5) return '🟠';
  return '🔴';
}

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

// POST /api/cron/guild-hall — update guild hall stockpile message per guild
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('Authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient();

  const { data: configs, error } = await supabase
    .from('guild_config')
    .select('guild_id, guild_name, api_key, settings')
    .neq('api_key', 'placeholder');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results: { guild: string; status: string }[] = [];
  const now = new Date();
  const dateLabel = now.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

  for (const config of configs ?? []) {
    const guildName: string = config.guild_name ?? config.guild_id;
    const settings = config.settings ?? {};
    const hallChannelId: string | undefined = settings.guild_hall_channel_id;
    const activeBuildings: string[] = settings.active_buildings ?? [];

    if (!hallChannelId || activeBuildings.length === 0 || !config.api_key) {
      results.push({ guild: guildName, status: 'skipped' });
      continue;
    }

    try {
      const api = new IdleMMOApi(config.api_key);
      const data = await api.getGuildHall(config.guild_id);
      const hall = data.guild_hall;

      // Filter upgrades matching active_buildings
      const activeUpgrades = hall.upgrades.filter(u =>
        activeBuildings.includes(u.blueprint.key.toLowerCase())
      );

      if (activeUpgrades.length === 0) {
        results.push({ guild: guildName, status: 'no_matching_upgrades' });
        continue;
      }

      // Building Status section
      const statusLines: string[] = [];
      for (const upgrade of activeUpgrades) {
        const name = upgrade.blueprint.name;
        if (upgrade.repair) {
          const rawPct = parseInt(upgrade.repair.condition_percentage.replace('%', ''), 10);
          const emoji = conditionEmoji(rawPct);
          statusLines.push(`${emoji} **${name}** — \`${upgrade.repair.condition_percentage}\``);
        } else {
          const statusKey = upgrade.status.key;
          const emoji = statusKey === 'IS_ACTIVE' ? '🟢' : statusKey === 'IN_CONSTRUCTION' ? '🔨' : '⚪';
          statusLines.push(`${emoji} **${name}** — \`${upgrade.status.readable}\``);
        }
      }

      // Donation Priority — aggregate requirements across all active upgrades
      const itemNeeded = new Map<string, number>();
      const itemCurrent = new Map<string, number>();

      for (const upgrade of activeUpgrades) {
        const reqs = upgrade.repair?.blueprint.requirements ?? [];
        for (const req of reqs) {
          const name = req.item.name;
          itemNeeded.set(name, (itemNeeded.get(name) ?? 0) + req.quantity.needed);
          if (req.quantity.current !== null && !itemCurrent.has(name)) {
            itemCurrent.set(name, req.quantity.current);
          }
        }
      }

      // Only show items where we have stockpile visibility
      const priorityItems = Array.from(itemNeeded.entries())
        .filter(([name]) => itemCurrent.has(name))
        .map(([name, needed]) => {
          const current = itemCurrent.get(name)!;
          const ratio = needed > 0 ? current / needed : 1;
          return { name, needed, current, ratio };
        })
        .sort((a, b) => a.ratio - b.ratio);

      const donationLines: string[] = [];
      for (let i = 0; i < priorityItems.length; i++) {
        const { name, needed, current, ratio } = priorityItems[i];
        const remaining = Math.max(0, needed - current);
        const pctNum = Math.round(ratio * 100) - 100;
        const pctStr = pctNum >= 0 ? `+${pctNum}%` : `${pctNum}%`;
        const emoji = NUMBER_EMOJIS[i] ?? `${i + 1}.`;
        const colorEmoji = remaining === 0 ? '✅' : fillEmoji(ratio);
        donationLines.push(
          `${emoji} **${name}** — \`${fmt(current)} / ${fmt(needed)}\` · \`${pctStr}\` · need \`${fmt(remaining)}\` more ${colorEmoji}`
        );
      }

      // Compose message
      const parts: string[] = [
        `## 🏰 Guild Hall — ${guildName}`,
        `*${dateLabel}*`,
        `### 🏛️ Building Status`,
        ...statusLines,
      ];

      if (donationLines.length > 0) {
        parts.push(
          `### 🤝 Donation Priority`,
          `*Total resources needed to fully repair each active building.*`,
          ``,
          ...donationLines,
          ``,
          `-# Resources sorted by fill ratio — items at the top are the highest priority for donations.`
        );
      }

      const content = parts.join('\n');

      // Post or edit
      let storedMessageId: string | undefined = settings.guild_hall_message_id;
      let posted = false;

      if (storedMessageId) {
        const editResult = await editChannelMessage(hallChannelId, storedMessageId, content);
        if (editResult.ok) {
          posted = true;
        } else {
          // Message was deleted — fall through to re-post
          storedMessageId = undefined;
        }
      }

      if (!posted) {
        const postResult = await postToChannelReturnId(hallChannelId, content);
        if (postResult.ok && postResult.messageId) {
          storedMessageId = postResult.messageId;
          await supabase
            .from('guild_config')
            .update({
              settings: { ...settings, guild_hall_message_id: storedMessageId },
            })
            .eq('guild_id', config.guild_id);
          posted = true;
        } else {
          results.push({ guild: guildName, status: `post_failed: ${postResult.error}` });
          continue;
        }
      }

      results.push({ guild: guildName, status: 'ok' });
    } catch (err) {
      console.error(`[guild-hall] Error for guild ${config.guild_id}:`, err);
      results.push({ guild: guildName, status: `error: ${String(err)}` });
    }
  }

  return NextResponse.json({ ok: true, results });
}
