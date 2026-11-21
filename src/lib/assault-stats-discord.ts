import { NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { editOriginalInteractionResponse } from '@/lib/discord-api';
import { formatGold } from '@/lib/utils';
import {
  getBestFinishes,
  getCurrentSeason,
  getSeasonOverview,
  getTopAssaulters,
  getTrackedExternalIds,
  getTrackedGuilds,
} from '@/lib/assault-standings-service';

interface Option { name: string; type?: number; value?: string | number; options?: Option[] }
interface Interaction { token: string; data: { options?: Option[] } }

const COLOR = 0xff6b35;
const medal = (i: number) => (['🥇', '🥈', '🥉'][i] ?? `**${i + 1}.**`);
const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

async function buildEmbed(sub: Option): Promise<unknown> {
  const ids = await getTrackedExternalIds();
  const seasonArg = sub.options?.find(o => o.name === 'season')?.value;

  if (sub.name === 'zones') {
    const best = await getBestFinishes(ids);
    if (best.length === 0) return { title: '🏆 Best Finishes', description: '_No standings stored yet._', color: COLOR };
    return {
      title: '🏆 Best Finishes per Location',
      color: COLOR,
      description: best.slice(0, 20).map((b, i) =>
        `${medal(i)} **${b.zone_name}** — ${ordinal(b.position)}/${b.of} · S${b.season_number} · ${b.guild_name} · ${formatGold(b.experience)} XP`).join('\n'),
    };
  }

  if (sub.name === 'top') {
    const season = seasonArg ? Number(seasonArg) : undefined;
    const top = await getTopAssaulters(ids, { season, limit: 15 });
    return {
      title: `⚔️ Top Dream Assaulters — ${season ? `Season ${season}` : 'All time'}`,
      color: COLOR,
      description: top.length === 0 ? '_No contribution data yet._' : top.map((t, i) =>
        `${medal(i)} **${t.character_name}**${t.total_level ? ` (Lv ${t.total_level})` : ''} — ${formatGold(t.experience)} XP · ${t.kills.toLocaleString()} kills`).join('\n'),
    };
  }

  // season
  const season = seasonArg ? Number(seasonArg) : await getCurrentSeason();
  const ov = await getSeasonOverview(season, await getTrackedGuilds());
  const fields = ov.guilds.map(g => ({
    name: `${g.guild_name}${g.guild_tag ? ` [${g.guild_tag}]` : ''} — ${g.overall_rank ? `${ordinal(g.overall_rank)} of ${g.of}` : 'unranked'}`,
    value: g.zones.length === 0
      ? '_No zone data_'
      : `${formatGold(g.experience)} XP total\n` + g.zones.slice(0, 8).map(z =>
          `• ${z.zone_name}: **${ordinal(z.position)}**/${z.of} · ${formatGold(z.experience)} XP`).join('\n'),
    inline: false,
  }));
  return {
    title: `🏰 Conquest Season ${season}`,
    description: 'Overall rank = total XP across all zones.',
    color: COLOR,
    fields: fields.length ? fields : [{ name: 'No data', value: 'Standings not synced yet.', inline: false }],
    footer: ov.snapshot_at ? { text: `Updated ${new Date(ov.snapshot_at).toISOString().slice(0, 16).replace('T', ' ')} UTC` } : undefined,
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
      await editOriginalInteractionResponse(appId, interaction.token, { embeds: [embed] });
    } catch (e) {
      await editOriginalInteractionResponse(appId, interaction.token, { content: `Stats failed: ${String(e)}` });
    }
  })());
  return NextResponse.json({ type: 5 });
}
