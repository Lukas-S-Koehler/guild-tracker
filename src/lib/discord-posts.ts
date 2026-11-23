/**
 * Discord post text built from the live guild directory. Used by Admin → Discord → Advertising
 * (copy-paste posts) and by the live #guild-info directory message (src/lib/live-messages.ts).
 */
import type { DirectoryGuild, GuildDirectory } from '@/lib/guild-directory';
import { raidTiers } from '@/lib/guild-fit';
import { PERK_GROUPS } from '@/lib/hub-perks';
import { ASSAULT_ENTRY_GUILD_ID, ASSAULT_TOP_GUILD_ID, ASSAULT_TOP_MIN_CL } from '@/lib/raids';
import { requirementLabel } from '@/components/guilds/GuildCard';

export const DISCORD_LIMIT = 2000;

export const tagged = (g: DirectoryGuild) => `${g.name} [${g.tag}]`;
export const raidCls = (g: DirectoryGuild) => (g.raids.length ? g.raids.map((r) => r.min_cl) : [g.min_level]);
export const req = (g: DirectoryGuild) => requirementLabel(g).replace(' gold', '');

export function raidLines(guilds: DirectoryGuild[]): string[] {
  return raidTiers(guilds)
    .slice()
    .reverse()
    .map((t) => {
      const gs = t.guilds as DirectoryGuild[];
      const cls = Array.from(new Set(gs.flatMap(raidCls))).sort((a, b) => a - b);
      return `**CL ${cls.join(' / ')} raids** · ${gs.map((g) => `${tagged(g)} ${req(g)}`).join(' · ')}`;
    });
}

export function noRaidLines(de?: DirectoryGuild, di?: DirectoryGuild): string[] {
  const out: string[] = [];
  if (de) out.push(`**${tagged(de)}** · Energizing Pools (up to 12% MF / 15% EXP), every level, casual assaults · ${req(de)}`);
  if (di) out.push(`**${tagged(di)}** · hardcore assaults, CL ${ASSAULT_TOP_MIN_CL}+ · ${req(di)}`);
  return out;
}

export function buildPosts(dir: GuildDirectory, site: string, guild: DirectoryGuild | null) {
  const active = dir.guilds.filter((g) => g.is_active);
  const de = active.find((g) => g.id === ASSAULT_ENTRY_GUILD_ID);
  const di = active.find((g) => g.id === ASSAULT_TOP_GUILD_ID);
  const n = dir.network;

  const full = [
    '# 💤 Dream Guilds · IdleMMO',
    `${n.active_guilds} guilds · ${n.members} players · one community. A guild for every combat level, and you move up as you grow.`,
    '',
    '## 🛡️ Raid guilds',
    ...raidLines(active),
    '',
    '## 💧 Pools & assaults',
    ...noRaidLines(de, di),
    '',
    '## ✨ What you get',
    ...PERK_GROUPS.map((g) => `${g.emoji} **${g.title}:** ${g.perks.join(' · ')}`),
    '',
    `🔗 Find your guild by CL: <${site}/guilds>`,
  ].join('\n');

  const short = [
    `**💤 Dream Guilds** · ${n.active_guilds} IdleMMO guilds, ${n.members} players`,
    `Raid guilds for every CL (${raidTiers(active).map((t) => t.cl).join(' → ')}), an Energizing Pools guild and hardcore assaults. DreamBot raid pings, daily activity checks, your own stats dashboard.`,
    `Find your guild: <${site}/guilds>`,
  ].join('\n');

  const ladder = [
    '## 🗺️ Dream Guilds ladder',
    ...raidLines(active),
    ...noRaidLines(de, di),
    '',
    'Your guild = the highest CL tier you reach. Full? Go one down. Pools and assaults are open alongside.',
    `<${site}/guilds>`,
  ].join('\n');

  let single: string | null = null;
  if (guild) {
    const g = guild;
    const what = g.is_assault
      ? g.id === ASSAULT_TOP_GUILD_ID
        ? `Hardcore assaults, CL ${ASSAULT_TOP_MIN_CL}+. No raids.`
        : 'Energizing Pools guild (up to 12% Magic Find / 15% EXP), every level. Casual assaults, no raids.'
      : `CL ${raidCls(g).join(' / ')} raids${g.min_level > 1 ? `, CL ${g.min_level}+ to join` : ', every level welcome'}.`;
    const lead = g.leadership.filter((l) => l.position === 'LEADER').map((l) => l.ign);
    single = [
      `# ${tagged(g)} is recruiting`,
      what,
      '',
      `💰 ${requirementLabel(g)}${g.overflow.enabled ? ' · overflow bank covers days off' : ''}`,
      `👥 ${g.member_count} members${lead.length ? ` · led by ${lead.join(', ')}` : ''}`,
      `📈 Last ${g.stats.days} days: ${g.stats.raids.toLocaleString()} raids`,
      '',
      `Apply in game: search **${g.tag}** in the guild list.`,
      `<${site}/guilds/${g.tag.toLowerCase()}>`,
    ].join('\n');
  }

  return { full, short, ladder, single };
}

