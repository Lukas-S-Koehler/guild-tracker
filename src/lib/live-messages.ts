/**
 * Registry + builders for DreamBot's live Discord messages (Dream Hub step 7).
 * Publishing mechanics live in src/lib/discord-live.ts; this file decides WHAT is posted.
 *
 * Sources:
 *  - 'build'     : rebuilt from site data (daily cron /api/cron/discord-live, or Admin → Discord → Live messages).
 *  - 'auto-warn' : produced by the daily activity check (/api/cron/auto-warn). Admins can only
 *                  republish the last stored copy.
 * A key does nothing until it is bound to a channel in the admin panel.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadGuildDirectory, type DirectoryGuild } from '@/lib/guild-directory';
import { raidTiers } from '@/lib/guild-fit';
import { raidCls, req, raidLines } from '@/lib/discord-posts';
import { buildRaidEmbed, CURSED_DREAMERS_ID } from '@/lib/raid-discord';
import { GUIDE_SITE_URL } from '@/lib/game-guide';
import { ASSAULT_ENTRY_GUILD_ID, ASSAULT_TOP_GUILD_ID, ASSAULT_TOP_MIN_CL } from '@/lib/raids';
import { RECAP_PREFIX, assaultRecapKey, recapPayloadsFor } from '@/lib/assault-recap';
import { KUDOS_WEEKLY_KEY, buildWeeklyShoutout, lastWeekStart } from '@/lib/kudos';
import { getLiveRow, messageLink, publishLive, textPayloads, type LiveMode, type LivePayload, type PublishResult } from '@/lib/discord-live';

/** Dream Guilds channel ids (see Claude memory reference-discord-channels). */
export const CHANNELS = {
  guildInfo: '1444861407978979459',
  raidPings: '1444772190737403925',
  usefulLinks: '1477382535523864858',
  dailyCheck: '1444817080204529694',
  guide: '1573818767505490051',
  leaguePartyFind: '1444751519588024492',
  market: '1444960928117555211',
  defiasForgery: '1444784878561529906',
  sparkForging: '1450444268798869504',
  suggestions: '1444809324697223309',
  giveaway: '1444813206592950477',
  pingRoles: '1444752252899299618',
} as const;

export const HALL_OF_FAME_KEY = 'hall-of-fame';

export interface LiveDef {
  key: string;
  label: string;
  description: string;
  /** Suggested channel when binding. */
  channel: string | null;
  mode: LiveMode;
  pin?: boolean;
  source: 'build' | 'auto-warn' | 'guild-hall' | 'achievements' | 'assault-recap' | 'kudos';
  /** Inactivity reports only: inactive guilds get no report (auto-warn skips them). */
  guild_active?: boolean;
  /** Inactivity reports only: @mention flagged members (guild_config.settings.disable_pings off). */
  pings?: boolean;
}

export const DAILY_BOARD_KEY = 'daily-board';
export const inactivityKey = (guildId: string) => `inactivity:${guildId}`;
export const guildHallKey = (guildId: string) => `guild-hall:${guildId}`;

export const STATIC_DEFS: LiveDef[] = [
  {
    key: 'guild-directory',
    label: 'Guild directory',
    description: 'Every Dream guild by CL tier with requirement, members and leaders. Replaces the manual #guild-info post. Edited in place daily.',
    channel: CHANNELS.guildInfo,
    mode: 'edit',
    pin: true,
    source: 'build',
  },
  {
    key: 'raid-schedule',
    label: 'Raid schedule',
    description: 'Raid times in local time plus which guild runs which CL raid. Pinned in #raid-pings, edited in place daily.',
    channel: CHANNELS.raidPings,
    mode: 'edit',
    pin: true,
    source: 'build',
  },
  {
    key: 'links-hub',
    label: 'Links hub',
    description: 'Website pages, key channels and bot commands in one post. Edited in place.',
    channel: CHANNELS.usefulLinks,
    mode: 'edit',
    source: 'build',
  },
  {
    key: DAILY_BOARD_KEY,
    label: 'Daily kick board',
    description: "One board per day for staff: everyone flagged in every guild, with DM status. Replaces the per-member lines in #daily-check. Yesterday's board is deleted.",
    channel: CHANNELS.dailyCheck,
    mode: 'repost',
    source: 'auto-warn',
  },
  {
    key: HALL_OF_FAME_KEY,
    label: 'Hall of fame',
    description: "Daily digest of Silver+ achievement unlocks (plus one launch post). New post each day; earlier ones stay. Bind to the new #hall-of-fame channel.",
    channel: null,
    mode: 'append',
    source: 'achievements',
  },
  {
    key: KUDOS_WEEKLY_KEY,
    label: 'Kudos of the week',
    description: "Weekly shoutout: who got the most kudos and why. Posted once for last week, from Monday after the daily check; earlier ones stay. Bind to #hall-of-fame.",
    channel: null,
    mode: 'append',
    source: 'kudos',
  },
];

/**
 * One inactivity report per guild in its guild chat. The live row's channel is the source of truth;
 * the old guild_config.settings.discord_log_channel_id is only the suggestion when binding.
 */
export async function inactivityDefs(supabase: SupabaseClient): Promise<LiveDef[]> {
  const [{ data }, { data: guilds }] = await Promise.all([
    supabase.from('guild_config').select('guild_id, guild_name, settings').order('guild_name'),
    supabase.from('guilds').select('id, is_active'),
  ]);
  const active = new Map((guilds ?? []).map((g: { id: string; is_active: boolean | null }) => [g.id, g.is_active !== false]));
  return (data ?? []).map((c: { guild_id: string; guild_name: string; settings: Record<string, unknown> | null }) => ({
    key: inactivityKey(c.guild_id),
    label: `Inactivity report · ${c.guild_name}`,
    description: "Daily inactivity report in the guild chat. Yesterday's report is deleted and today's posted fresh, so @mentions still notify.",
    channel: (c.settings?.discord_log_channel_id as string | undefined) ?? null,
    mode: 'repost' as const,
    source: 'auto-warn' as const,
    guild_active: active.get(c.guild_id) ?? true,
    pings: c.settings?.disable_pings !== true,
  }));
}

/** Guild hall stockpile + donation priority per guild, produced by /api/cron/guild-hall (15:50 UTC). */
export async function guildHallDefs(supabase: SupabaseClient): Promise<LiveDef[]> {
  const { data } = await supabase.from('guild_config').select('guild_id, guild_name, settings').order('guild_name');
  return (data ?? []).map((c: { guild_id: string; guild_name: string; settings: Record<string, unknown> | null }) => ({
    key: guildHallKey(c.guild_id),
    label: `Guild hall · ${c.guild_name}`,
    description: 'Building condition, stockpile and donation priority. Needs the guild API key and active buildings (Admin → Guilds). Edited in place daily.',
    channel: (c.settings?.guild_hall_channel_id as string | undefined) ?? null,
    mode: 'edit' as const,
    source: 'guild-hall' as const,
  }));
}

/**
 * One-time move of the old guild_config.settings.guild_hall_channel_id / guild_hall_message_id
 * onto live rows, keeping the existing message so it is edited, not reposted. Idempotent.
 */
export async function adoptLegacyGuildHalls(supabase: SupabaseClient) {
  const { data } = await supabase.from('guild_config').select('guild_id, settings');
  for (const c of data ?? []) {
    const s = (c.settings ?? {}) as Record<string, unknown>;
    if (typeof s.guild_hall_channel_id !== 'string' || !s.guild_hall_channel_id) continue;
    const key = guildHallKey(c.guild_id);
    if (await getLiveRow(supabase, key)) continue;
    await supabase.from('discord_live_messages').upsert(
      {
        key,
        channel_id: s.guild_hall_channel_id,
        message_ids: typeof s.guild_hall_message_id === 'string' && s.guild_hall_message_id ? [s.guild_hall_message_id] : [],
        enabled: true,
      },
      { onConflict: 'key' }
    );
  }
}

/** Season recap per assault guild (step 10): posted once when its season_end has passed. */
export async function assaultRecapDefs(supabase: SupabaseClient): Promise<LiveDef[]> {
  const [{ data: guilds }, { data: cfgs }] = await Promise.all([
    supabase.from('guilds').select('id, name').eq('is_assault', true).order('name'),
    supabase.from('assault_configs').select('guild_id, announcement_channel_id'),
  ]);
  const channel = new Map((cfgs ?? []).map((c: { guild_id: string; announcement_channel_id: string | null }) => [c.guild_id, c.announcement_channel_id]));
  return (guilds ?? []).map((g: { id: string; name: string }) => ({
    key: assaultRecapKey(g.id),
    label: `Season recap · ${g.name}`,
    description: "End-of-season recap: zone finishes, top EXP and kills, iron attendance, button to each member's own recap. Posted once, the day after the guild's season end date (Admin → Assault). Update now posts the latest season's recap.",
    channel: channel.get(g.id) ?? null,
    mode: 'append' as const,
    source: 'assault-recap' as const,
  }));
}

export async function allDefs(supabase: SupabaseClient): Promise<LiveDef[]> {
  const [inactivity, halls, recaps] = await Promise.all([inactivityDefs(supabase), guildHallDefs(supabase), assaultRecapDefs(supabase)]);
  return [...STATIC_DEFS, ...inactivity, ...halls, ...recaps];
}

export const findStaticDef = (key: string) => STATIC_DEFS.find((d) => d.key === key) ?? null;

// ─── Builders ────────────────────────────────────────────────────────────────

const SITE = GUIDE_SITE_URL;
/** In-game guild page; the guild name in the directory links here. */
export const gameGuildUrl = (guildId: string) => `https://web.idle-mmo.com/guilds?guild_id=${guildId}&same_window=true`;

type Contacts = Map<string, string>; // ign → Discord mention or bold IGN

/** Leader + deputies as Discord mentions (no ping: textPayloads allows no mentions). IGN when not linked. */
async function leadershipContacts(supabase: SupabaseClient, guildIds: string[]): Promise<Contacts> {
  const { data } = await supabase
    .from('members')
    .select('ign, discord_id')
    .in('current_guild_id', guildIds)
    .in('position', ['LEADER', 'DEPUTY'])
    .eq('is_active', true);
  return new Map((data ?? []).map((m: { ign: string; discord_id: string | null }) => [m.ign, m.discord_id ? `<@${m.discord_id}>` : m.ign]));
}

function guildLine(g: DirectoryGuild, contacts: Contacts, extra?: string): string {
  const who = (pos: string) => g.leadership.filter((l) => l.position === pos).map((l) => contacts.get(l.ign) ?? l.ign);
  const people = [who('LEADER').length && `👑 ${who('LEADER').join(' ')}`, who('DEPUTY').length && `🛡️ ${who('DEPUTY').join(' ')}`].filter(Boolean);
  const name = `**[${g.name} (${g.tag})](<${gameGuildUrl(g.id)}>)**`;
  return [name, extra, req(g), `${g.member_count} members`, ...people].filter(Boolean).join(' · ');
}

async function buildGuildDirectory(supabase: SupabaseClient): Promise<LivePayload[]> {
  const dir = await loadGuildDirectory(supabase);
  const active = dir.guilds.filter((g) => g.is_active);
  const contacts = await leadershipContacts(supabase, active.map((g) => g.id));
  const de = active.find((g) => g.id === ASSAULT_ENTRY_GUILD_ID);
  const di = active.find((g) => g.id === ASSAULT_TOP_GUILD_ID);
  const n = dir.network;

  const lines = [
    '# 💤 Dream Guilds',
    `${n.active_guilds} guilds · ${n.members} players. Join the **highest CL tier you reach**; if it's full, go one tier down. Move up as your CL grows.`,
    `-# Tap a guild to open it in game and apply. Questions? Ask its 👑 leader or 🛡️ deputies. Match by CL: <${SITE}/guilds>`,
  ];
  for (const tier of raidTiers(active).slice().reverse()) {
    lines.push('', tier.cl <= 1 ? '### ⚔️ All levels' : `### ⚔️ CL ${tier.cl}+`);
    for (const g of tier.guilds as DirectoryGuild[]) {
      const cls = raidCls(g);
      // Only spell out the raids when they differ from the tier heading (e.g. DC runs CL 40 and 60).
      const raids = cls.length > 1 || cls[0] !== tier.cl ? `CL ${cls.join(' / ')} raids` : undefined;
      lines.push(guildLine(g, contacts, raids));
    }
  }
  if (de || di) lines.push('', '### 💧 Pools & assaults (no raids)');
  if (de) lines.push(guildLine(de, contacts, 'Energizing Pools (up to 12% MF / 15% EXP), every level'));
  if (di) lines.push(guildLine(di, contacts, `hardcore assaults, CL ${ASSAULT_TOP_MIN_CL}+`));
  return textPayloads(lines);
}

async function buildRaidSchedule(supabase: SupabaseClient): Promise<LivePayload[]> {
  const dir = await loadGuildDirectory(supabase);
  const active = dir.guilds.filter((g) => g.is_active);
  const cursedActive = active.some((g) => g.id === CURSED_DREAMERS_ID);
  const embed = buildRaidEmbed({ live: true, cursed: cursedActive }) as { fields: { name: string; value: string; inline: boolean }[] } & Record<string, unknown>;
  const ladder = raidLines(active).join('\n');
  embed.fields.push({
    name: '🛡️ Which raid is mine?',
    value: (ladder ? `${ladder}\n` : '') + `Assault guilds run no raids. Find your guild: <${SITE}/guilds>`,
    inline: false,
  });
  return [{ embeds: [embed], allowed_mentions: { parse: [] } }];
}

async function buildLinksHub(supabase: SupabaseClient): Promise<LivePayload[]> {
  const ch = (id: string) => `<#${id}>`;
  const directory = await getLiveRow(supabase, 'guild-directory'); // jump link once the directory is live
  const lines = [
    '# 🔗 Dream Guilds links',
    '## 🌐 Website',
    `• **Find your guild** by CL: <${SITE}/guilds>`,
    `• **Your dashboard** (daily check, streaks, ranks): <${SITE}/me>`,
    `• **Guide**: <${SITE}/guide>`,
    `• **Combat tool**: <${SITE}/combat>`,
    `• **Assault** live, rankings and prep: <${SITE}/assault>`,
    `• **Leaderboard**: <${SITE}/leaderboard>`,
    `-# Run \`/claim\` to link your Discord and claim your character: unlocks the member pages and keeps your guild roles in sync.`,
    '',
    '## 💬 Channels',
    `• Guild directory: ${directory?.message_ids[0] ? messageLink(directory.channel_id, directory.message_ids[0]) : ch(CHANNELS.guildInfo)}`,
    `• Raid times and pings: ${ch(CHANNELS.raidPings)} · ping roles: ${ch(CHANNELS.pingRoles)}`,
    `• Game guide: ${ch(CHANNELS.guide)}`,
    `• League party finder: ${ch(CHANNELS.leaguePartyFind)} · market: ${ch(CHANNELS.market)}`,
    `• Forging: ${ch(CHANNELS.defiasForgery)} · ${ch(CHANNELS.sparkForging)}`,
    `• Giveaways: ${ch(CHANNELS.giveaway)} · suggestions: ${ch(CHANNELS.suggestions)}`,
    '',
    '## 🤖 DreamBot commands',
    '`/claim` link your Discord + claim your character · `/me` daily check and streaks · `/away` holiday',
    '`/guild` any guild at a glance · `/raid` raid times · `/leaderboard` activity ranks · `/kudos give` thank someone',
    '`/assault me` your assault season · `/assault checklist` prep checklist · `/assault status` assault countdowns · `/guide show` guide links',
    '-# `/help` lists every command, including the staff ones.',
  ];
  return textPayloads(lines);
}

const BUILDERS: Record<string, (s: SupabaseClient) => Promise<LivePayload[]>> = {
  'guild-directory': buildGuildDirectory,
  'raid-schedule': buildRaidSchedule,
  'links-hub': buildLinksHub,
};

export const canBuild = (key: string) => key in BUILDERS;

/** Fresh payloads for a buildable key; for auto-warn keys, the last stored copy (or null). */
export async function payloadsFor(supabase: SupabaseClient, key: string): Promise<LivePayload[] | null> {
  if (BUILDERS[key]) return BUILDERS[key](supabase);
  if (key.startsWith(RECAP_PREFIX)) return recapPayloadsFor(supabase, key);
  if (key === KUDOS_WEEKLY_KEY) return buildWeeklyShoutout(supabase, lastWeekStart());
  return (await getLiveRow(supabase, key))?.payloads ?? null;
}

/** Publish one key with its def's mode. */
export async function publishKey(supabase: SupabaseClient, key: string, force = false): Promise<PublishResult> {
  const def = findStaticDef(key) ?? (await allDefs(supabase)).find((d) => d.key === key);
  if (!def) return { ok: false, status: 'error', message_ids: [], error: `Unknown live message ${key}` };
  const payloads = await payloadsFor(supabase, key);
  if (!payloads?.length) return { ok: false, status: 'error', message_ids: [], error: def.source === 'guild-hall' ? 'Nothing posted yet: comes with the daily guild hall run (15:50 UTC).' : def.source === 'achievements' ? 'Nothing posted yet: comes with the daily achievements run after the activity check.' : def.source === 'assault-recap' ? 'No assault waves recorded for this guild yet.' : def.source === 'kudos' ? 'Nobody gave kudos last week.' : 'Nothing posted yet: comes with the daily activity check (11:48 UTC).' };
  return publishLive(supabase, key, payloads, { mode: def.mode, pin: def.pin, force });
}

/** Rebuild every bound, buildable key (daily cron). */
export async function refreshBuiltLive(supabase: SupabaseClient, force = false) {
  const out: Record<string, PublishResult> = {};
  for (const def of STATIC_DEFS.filter((d) => d.source === 'build')) {
    const row = await getLiveRow(supabase, def.key);
    if (!row) continue;
    try {
      out[def.key] = await publishLive(supabase, def.key, await BUILDERS[def.key](supabase), { mode: def.mode, pin: def.pin, force });
    } catch (err) {
      out[def.key] = { ok: false, status: 'error', message_ids: [], error: String(err) };
    }
  }
  return out;
}

// ─── Daily kick board (fed by auto-warn) ─────────────────────────────────────

export type DmStatus = 'sent' | 'failed' | 'no-discord' | 'paused' | 'earlier';

export interface BoardMember {
  ign: string;
  days: number;
  level: 'warn1' | 'warn2' | 'kick';
  dm: DmStatus;
}

export interface BoardGuild {
  name: string;
  tag: string | null;
  members: BoardMember[];
  bankCovered: number;
  /** Members skipped because of /away. */
  away?: number;
  reportUrl: string | null;
  /** guilds.display_order, for sorting. */
  order: number;
}

const DM_ICON: Record<DmStatus, string> = { sent: '✅', failed: '❌', 'no-discord': '🔇', paused: '⏸️', earlier: '🔁' };

export function buildDailyBoard(guilds: BoardGuild[], checkedDayTs: number): LivePayload[] {
  const all = guilds.flatMap((g) => g.members);
  const count = (lvl: BoardMember['level'], list = all) => list.filter((m) => m.level === lvl).length;
  const lines = [
    `# 📋 Daily check · <t:${checkedDayTs}:D>`,
    `**${count('kick')}** 🚫 kick · **${count('warn2')}** ⚠️⚠️ final warning · **${count('warn1')}** ⚠️ warning`,
    `-# DM for new warnings today: ✅ sent · ❌ failed · 🔇 no Discord linked · ⏸️ DMs paused · 🔁 warned before`,
  ];
  const clear: string[] = [];
  const name = (g: BoardGuild) => (g.tag ? `${g.name} [${g.tag}]` : g.name);
  const fmt = (m: BoardMember) => `**${m.ign}** ${m.days}d ${DM_ICON[m.dm]}`;

  for (const g of guilds) {
    if (!g.members.length) {
      clear.push(g.tag ?? g.name);
      continue;
    }
    const head = [`🚫 ${count('kick', g.members)}`, `⚠️⚠️ ${count('warn2', g.members)}`, `⚠️ ${count('warn1', g.members)}`].join(' · ');
    lines.push('', `## ${name(g)} · ${head}${g.reportUrl ? ` · [report](${g.reportUrl})` : ''}`);
    const by = (lvl: BoardMember['level']) => g.members.filter((m) => m.level === lvl).sort((a, b) => b.days - a.days);
    if (by('kick').length) lines.push(`🚫 ${by('kick').map(fmt).join(' · ')}`);
    if (by('warn2').length) lines.push(`⚠️⚠️ ${by('warn2').map(fmt).join(' · ')}`);
    if (by('warn1').length) lines.push(`⚠️ ${by('warn1').map(fmt).join(' · ')}`);
    if (g.bankCovered) lines.push(`-# 🏦 ${g.bankCovered} covered by the shared alt bank`);
    if (g.away) lines.push(`-# 🌴 ${g.away} on holiday (/away)`);
  }
  if (clear.length) lines.push('', `✅ **All clear:** ${clear.join(', ')}`);
  return textPayloads(lines);
}
