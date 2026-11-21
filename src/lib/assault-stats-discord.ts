import { NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { editOriginalInteractionResponse } from '@/lib/discord-api';
import { formatGold } from '@/lib/utils';
import { COLORS, ordinal, siteUrl, linkRow, padR, padL } from '@/lib/assault-embed';
import {
  getBestFinishes,
  getCurrentSeason,
  getSeasonOverview,
  getTopAssaulters,
  getDreamExternalIds,
  getTrackedGuilds,
} from '@/lib/assault-standings-service';

interface Option { name: string; type?: number; value?: string | number; options?: Option[] }
interface Interaction { token: string; data: { options?: Option[] } }

const COLOR = COLORS.orange;
const FOOT = { text: 'Full stats on the website' };

async function buildEmbed(sub: Option): Promise<unknown> {
  const ids = await getDreamExternalIds();
  const seasonArg = sub.options?.find(o => o.name === 'season')?.value;

  if (sub.name === 'zones') {
    const best = await getBestFinishes(ids);
    if (best.length === 0) return { title: '🏆 Best Finishes', description: '_No standings stored yet._', color: COLOR };
    const zoneW = Math.min(20, Math.max(...best.slice(0, 20).map(b => b.zone_name.length)));
    const rows = best.slice(0, 20).map(b =>
      `${padR(b.zone_name, zoneW)} ${padL(`${ordinal(b.position)}/${b.of}`, 7)} S${padR(String(b.season_number), 3)} ${padL(formatGold(b.experience), 7)}  ${b.guild_name}`);
    return {
      title: '🏆 Best Finishes per Location',
      url: siteUrl('/assault/hall-of-fame'),
      color: COLOR,
      description: '```\n' + rows.join('\n') + '\n```',
      footer: FOOT,
    };
  }

  if (sub.name === 'top') {
    const season = seasonArg ? Number(seasonArg) : undefined;
    const top = await getTopAssaulters(ids, { season, limit: 15 });
    const nameW = Math.min(18, Math.max(4, ...top.map(t => t.character_name.length)));
    const rows = top.map((t, i) =>
      `${padL(String(i + 1), 2)} ${padR(t.character_name, nameW)} ${padL(formatGold(t.experience), 7)} XP ${padL(t.kills.toLocaleString(), 8)} kills`);
    return {
      title: `⚔️ Top Dream Assaulters — ${season ? `Season ${season}` : 'All time'}`,
      url: siteUrl('/assault/hall-of-fame'),
      color: COLOR,
      description: top.length === 0 ? '_No contribution data yet._' : '```\n' + rows.join('\n') + '\n```',
      footer: FOOT,
    };
  }

  // season
  const season = seasonArg ? Number(seasonArg) : await getCurrentSeason();
  const ov = await getSeasonOverview(season, await getTrackedGuilds());
  const fields = ov.guilds.map(g => {
    const zones = g.zones.slice(0, 3).map(z =>
      `• ${z.zone_name}: **${ordinal(z.position)}**/${z.of} · ${formatGold(z.experience)}`);
    const more = g.zones.length > 3 ? `\n_+${g.zones.length - 3} more_` : '';
    return {
      name: `${g.guild_name}${g.guild_tag ? ` [${g.guild_tag}]` : ''}`,
      value: g.zones.length === 0
        ? '_No zone data_'
        : `**${g.overall_rank ? `${ordinal(g.overall_rank)} of ${g.of}` : 'unranked'}** · ${formatGold(g.experience)} XP\n${zones.join('\n')}${more}`,
      inline: true,
    };
  });
  return {
    title: `🏰 Conquest Season ${season}`,
    url: siteUrl('/assault/stats'),
    description: 'Overall rank = total XP across all zones.',
    color: COLOR,
    fields: fields.length ? fields : [{ name: 'No data', value: 'Standings not synced yet.', inline: false }],
    footer: ov.snapshot_at ? { text: `Updated ${new Date(ov.snapshot_at).toISOString().slice(0, 16).replace('T', ' ')} UTC · full stats on the website` } : FOOT,
  };
}

export function handleAssaultStatsCommand(interaction: Interaction) {
  const sub = interaction.data.options?.[0];
  const appId = process.env.DISCORD_APPLICATION_ID;
  if (!sub || !appId) {
    return NextResponse.json({ type: 4, data: { content: 'Bad command.', flags: 64 } });
  }
  waitUntil((async () => {
    try {
      const embed = await buildEmbed(sub);
      await editOriginalInteractionResponse(appId, interaction.token, { embeds: [embed], components: [linkRow('/assault/hall-of-fame', 'Hall of fame & stats')] });
    } catch (e) {
      await editOriginalInteractionResponse(appId, interaction.token, { content: `Stats failed: ${String(e)}` });
    }
  })());
  return NextResponse.json({ type: 5 });
}
