/**
 * Dream Hub Discord commands (step 8): /help, /claim, /me, /guild, /away.
 * Routed from src/app/api/discord/interactions/route.ts. Registered with registerHubCommands().
 */
import { NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase-server';
import { editOriginalInteractionResponse, postToChannel, upsertGlobalCommand } from '@/lib/discord-api';
import { getActiveClaim } from '@/lib/account-service';
import { getLinkByDiscord, linkUrl, mappedIgns } from '@/lib/discord-link';
import { buildMeSummary, type GuildGroup } from '@/lib/me-summary';
import { findGuildByTag, loadGuildDirectory } from '@/lib/guild-directory';
import { raidCls, req } from '@/lib/discord-posts';
import { gameGuildUrl } from '@/lib/live-messages';
import { GUIDE_SITE_URL } from '@/lib/game-guide';
import { ASSAULT_ENTRY_GUILD_ID, ASSAULT_TOP_GUILD_ID, ASSAULT_TOP_MIN_CL } from '@/lib/raids';
import { HOLIDAY_LOG_CHANNEL, MAX_AWAY_DAYS, awayUnix, endAway, getActiveAway, listActiveAway, setAway } from '@/lib/away';
import { outranks, outrankError, rankOfRole } from '@/lib/role-hierarchy';

const SITE = GUIDE_SITE_URL;
const CRYSTAL = 0x4cc9f0;
const EPHEMERAL = 64;

type Opt = { name: string; type?: number; value?: string | number | boolean; focused?: boolean; options?: Opt[] };
export interface HubInteraction {
  token: string;
  application_id: string;
  member?: { user?: { id: string; username: string; global_name?: string | null }; roles?: string[] };
  user?: { id: string; username: string; global_name?: string | null };
  data: { name?: string; options?: Opt[]; custom_id?: string };
}

const caller = (i: HubInteraction) => i.member?.user ?? i.user;
const reply = (data: Record<string, unknown>) => NextResponse.json({ type: 4, data: { allowed_mentions: { parse: [] }, ...data } });
const ephemeral = (content: string, extra: Record<string, unknown> = {}) => reply({ content, flags: EPHEMERAL, ...extra });
const linkButton = (label: string, url: string) => ({ type: 2, style: 5, label, url });
const row = (...components: unknown[]) => ({ type: 1, components });
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

/** Defer (ephemeral or public), then fill the reply in the background. */
function deferred(i: HubInteraction, ephemeralReply: boolean, work: () => Promise<Record<string, unknown>>) {
  waitUntil(
    (async () => {
      let payload: Record<string, unknown>;
      try {
        payload = await work();
      } catch (err) {
        console.error('[hub-discord]', err);
        payload = { content: `Something went wrong: ${String(err).slice(0, 300)}` };
      }
      await editOriginalInteractionResponse(i.application_id, i.token, { allowed_mentions: { parse: [] }, ...payload });
    })()
  );
  return NextResponse.json({ type: 5, data: ephemeralReply ? { flags: EPHEMERAL } : {} });
}

// ─── /claim ──────────────────────────────────────────────────────────────────

async function claimPayload(supabase: SupabaseClient, discordId: string, username: string) {
  const link = await getLinkByDiscord(supabase, discordId);
  if (link) {
    const claim = await getActiveClaim(link.user_id, supabase);
    const content = !claim
      ? `🔗 Your Discord is linked to your Dream Guilds account, but no character is claimed yet. Claim your main on the site and an officer approves it.`
      : claim.status === 'approved'
        ? `✅ All set: your Discord is linked and **${claim.ign}** is claimed. Use \`/me\` for your daily check and streaks.`
        : `⏳ Your Discord is linked and your claim on **${claim.ign}** is waiting for an officer.`;
    return {
      content,
      flags: EPHEMERAL,
      components: [row(linkButton(claim?.status === 'approved' ? 'My dashboard' : 'My characters', `${SITE}/${claim?.status === 'approved' ? 'me' : 'account'}`))],
    };
  }

  const igns = await mappedIgns(supabase, discordId);
  const lines = [
    '## 💎 Claim your character',
    'Link this Discord to your Dream Guilds website account. You get your own dashboard (daily check, streaks, ranks) and your guild roles here follow the game automatically.',
    '',
    igns.length
      ? `We already know you as **${igns.join('**, **')}**. Linking claims ${igns.length > 1 ? 'that account' : 'it'} right away, no approval needed.`
      : 'After linking, search your main character on the site. An officer of your guild approves it.',
    '',
    '1. Press **Link my account** (opens the website, link valid for 30 minutes).',
    '2. Sign in, or create an account if you have none.',
    "3. Done. Come back and run `/me`.",
  ];
  return {
    content: lines.join('\n'),
    flags: EPHEMERAL,
    components: [row(linkButton('Link my account', linkUrl(discordId, username)), linkButton('Find your guild', `${SITE}/guilds`))],
  };
}

export async function handleClaim(i: HubInteraction) {
  const u = caller(i);
  if (!u) return ephemeral('Could not identify you.');
  const supabase = createAdminClient();
  return reply(await claimPayload(supabase, u.id, u.global_name ?? u.username));
}

// ─── /me ─────────────────────────────────────────────────────────────────────

const WARN: Record<string, string> = { safe: '', warn1: '⚠️ warning', warn2: '⚠️⚠️ final warning', kick: '🚫 kick notice' };

function groupLine(g: GuildGroup): string {
  const tag = g.guild_nickname ?? g.guild_name;
  const reqText = `${g.period === 'weekly' ? 'weekly' : 'daily'} ${fmt(g.required)}g`;
  let state: string;
  if (g.exempt) state = '🛡️ exempt (leadership)';
  else if (g.away_until) state = `🌴 on holiday, back <t:${awayUnix(g.away_until)}:D>`;
  else {
    const best = Math.max(0, ...g.members.map((m) => m.contributed));
    state = g.met ? '✅ met' : g.period === 'weekly' ? `⏳ ${fmt(Math.max(0, g.required - best))}g to go` : '❌ missed';
    if (g.warning_level !== 'safe') state += ` · ${WARN[g.warning_level]} (${g.days_inactive}d)`;
  }
  const streak = g.streak.current > 0 ? ` · 🔥 ${g.streak.current}${g.streak.unit === 'day' ? 'd' : 'w'}` : '';
  return `**${tag}** · ${reqText} · ${state}${streak}\n-# ${g.members.map((m) => m.ign).join(', ')}`;
}

export function handleMe(i: HubInteraction) {
  const u = caller(i);
  if (!u) return ephemeral('Could not identify you.');
  const share = i.data.options?.find((o) => o.name === 'share')?.value === true;
  return deferred(i, !share, async () => {
    const supabase = createAdminClient();
    const link = await getLinkByDiscord(supabase, u.id);
    if (!link) return { content: 'Your Discord is not linked to a website account yet. Run `/claim` first.' };
    const s = await buildMeSummary(link.user_id, {}, supabase);
    if (!s.claimed) {
      return {
        content: s.pending ? `⏳ Your claim on **${s.pending.ign}** is waiting for an officer.` : 'No character claimed yet. Claim your main on the site.',
        components: [row(linkButton('My characters', `${SITE}/account`))],
      };
    }
    const away = await getActiveAway(supabase, u.id);
    const checked = Math.floor(new Date(s.check.checked_day + 'T11:50:00Z').getTime() / 1000) + 86_400;
    const lines = [
      s.groups.length ? s.groups.map(groupLine).join('\n') : '_None of your characters is in an active Dream guild._',
      '',
      `-# Last check <t:${checked}:R> · next <t:${Math.floor(new Date(s.check.next_check_at).getTime() / 1000)}:R>`,
    ];
    if (away) lines.push(`🌴 Holiday until <t:${awayUnix(away.ends_on)}:D>${away.reason ? ` (${away.reason})` : ''}. \`/away end\` when you're back early.`);
    return {
      embeds: [
        {
          title: `${s.main.ign}${s.main.guild_nickname ? ` · ${s.main.guild_nickname}` : ''}`,
          url: `${SITE}/me`,
          color: CRYSTAL,
          thumbnail: s.main.avatar_url ? { url: s.main.avatar_url } : undefined,
          description: lines.join('\n'),
          fields: [
            { name: 'Lifetime gold', value: fmt(s.tiles.lifetime_gold), inline: true },
            { name: 'Raids', value: fmt(s.tiles.lifetime_raids), inline: true },
            { name: 'Days met', value: `${fmt(s.tiles.days_met)} / ${fmt(s.tiles.days_logged)}`, inline: true },
            ...(s.tiles.assault_runs ? [{ name: 'Assault kills', value: fmt(s.tiles.assault_kills), inline: true }] : []),
            { name: 'Characters', value: s.characters.map((c) => c.ign).join(', ').slice(0, 1000) || '—', inline: false },
          ],
        },
      ],
      components: [row(linkButton('Open my dashboard', `${SITE}/me`))],
    };
  });
}

// ─── /guild <tag> ────────────────────────────────────────────────────────────

export async function handleGuildAutocomplete(i: HubInteraction) {
  const q = String(i.data.options?.find((o) => o.focused)?.value ?? '').toLowerCase();
  const supabase = createAdminClient();
  const { data } = await supabase.from('guilds').select('name, nickname, is_active').order('display_order');
  const choices = (data ?? [])
    .filter((g) => g.is_active !== false && g.nickname)
    .filter((g) => !q || g.nickname.toLowerCase().includes(q) || g.name.toLowerCase().includes(q))
    .slice(0, 25)
    .map((g) => ({ name: `${g.nickname} · ${g.name}`, value: g.nickname }));
  return NextResponse.json({ type: 8, data: { choices } });
}

export function handleGuild(i: HubInteraction) {
  const tag = String(i.data.options?.find((o) => o.name === 'tag')?.value ?? '').trim();
  if (!tag) return ephemeral('Pick a guild.');
  return deferred(i, false, async () => {
    const supabase = createAdminClient();
    const dir = await loadGuildDirectory(supabase);
    const g = findGuildByTag(dir, tag);
    if (!g || !g.is_active) return { content: `No active Dream guild **${tag}**. Try \`/guild\` and pick from the list.` };

    const { data: leaders } = await supabase
      .from('members')
      .select('ign, discord_id, position')
      .eq('current_guild_id', g.id)
      .in('position', ['LEADER', 'DEPUTY'])
      .eq('is_active', true);
    const who = (pos: string) => (leaders ?? []).filter((l) => l.position === pos).map((l) => (l.discord_id ? `<@${l.discord_id}>` : l.ign)).join(' ') || '—';

    const kind =
      g.id === ASSAULT_ENTRY_GUILD_ID
        ? 'Energizing Pools guild (casual assaults), open to every level'
        : g.id === ASSAULT_TOP_GUILD_ID
          ? `Hardcore assaults, CL ${ASSAULT_TOP_MIN_CL}+`
          : `CL ${raidCls(g).join(' / ')} raids · join from CL ${g.min_level}`;
    const st = g.stats;
    return {
      embeds: [
        {
          title: `${g.name} (${g.tag})`,
          url: `${SITE}/guilds/${encodeURIComponent(g.tag)}`,
          color: CRYSTAL,
          description: `${kind}\nRequirement: **${req(g)}**${g.overflow.enabled ? ` · activity bank up to ${fmt(g.overflow.limit)}g` : ''}`,
          fields: [
            { name: 'Members', value: String(g.member_count), inline: true },
            { name: `Last ${st.days} days`, value: `${fmt(st.gold)}g · ${fmt(st.raids)} raids${st.met_rate !== null ? ` · ${Math.round(st.met_rate * 100)}% met` : ''}`, inline: true },
            { name: '👑 Leader', value: who('LEADER'), inline: false },
            { name: '🛡️ Deputies', value: who('DEPUTY'), inline: false },
            ...(g.buildings.length ? [{ name: 'Buildings', value: g.buildings.join(', ').slice(0, 1000), inline: false }] : []),
          ],
        },
      ],
      components: [row(linkButton('Apply in game', gameGuildUrl(g.id)), linkButton('Guild page', `${SITE}/guilds/${encodeURIComponent(g.tag)}`))],
    };
  });
}

// ─── /away ───────────────────────────────────────────────────────────────────

async function rankOfDiscord(supabase: SupabaseClient, discordId: string): Promise<number> {
  const { data } = await supabase.from('members').select('position').eq('discord_id', discordId).eq('is_active', true);
  return Math.max(0, ...(data ?? []).map((c) => rankOfRole(c.position)));
}

export function handleAway(i: HubInteraction) {
  const u = caller(i);
  if (!u) return ephemeral('Could not identify you.');
  const sub = i.data.options?.[0];
  const opt = (n: string) => sub?.options?.find((o) => o.name === n)?.value;
  const target = (opt('user') as string | undefined) ?? u.id;
  const forOther = target !== u.id;

  return deferred(i, true, async () => {
    const supabase = createAdminClient();

    if (sub?.name === 'list') {
      const rows = await listActiveAway(supabase);
      if (!rows.length) return { content: '🌴 Nobody is on holiday right now.' };
      return { content: ['🌴 **On holiday**', ...rows.map((r) => `• <@${r.discord_id}> back <t:${awayUnix(r.ends_on)}:D>${r.reason ? ` · ${r.reason}` : ''}`)].join('\n').slice(0, 1990) };
    }

    // Setting or ending someone else's holiday: only for people ranked below you (role-hierarchy.ts).
    if (forOther) {
      const [mine, theirs] = await Promise.all([rankOfDiscord(supabase, u.id), rankOfDiscord(supabase, target)]);
      if (!outranks(mine, theirs)) return { content: `❌ ${outrankError(mine, theirs, 'set holidays for')}.` };
    }
    const who = forOther ? `<@${target}>` : 'You';

    if (sub?.name === 'end') {
      const ended = await endAway(supabase, target);
      if (!ended) return { content: `${who} ${forOther ? 'is' : 'are'} not on holiday.` };
      await postToChannel(HOLIDAY_LOG_CHANNEL, `🏠 <@${target}> is back from holiday${forOther ? ` (ended by <@${u.id}>)` : ''}.`);
      return { content: `🏠 Holiday ended. ${forOther ? 'Their' : 'Your'} activity counts again from today.` };
    }

    const days = Number(opt('days'));
    if (!Number.isInteger(days) || days < 1 || days > MAX_AWAY_DAYS) return { content: `Days must be 1 to ${MAX_AWAY_DAYS}.` };
    const reason = ((opt('reason') as string | undefined) ?? '').trim().slice(0, 200) || null;
    const res = await setAway(supabase, { discordId: target, days, reason, by: u.id });
    if ('error' in res) return { content: `❌ ${res.error}` };
    const back = `<t:${awayUnix(res.period.ends_on)}:D>`;
    const { data: chars } = await supabase.from('members').select('ign').in('id', res.period.member_ids);
    const igns = (chars ?? []).map((c) => c.ign).join(', ');
    await postToChannel(
      HOLIDAY_LOG_CHANNEL,
      `🌴 <@${target}> (${igns}) is away for **${days} day${days === 1 ? '' : 's'}**, back ${back}${reason ? ` · ${reason}` : ''}${forOther ? ` · set by <@${u.id}>` : ''}`
    );
    return {
      content: `🌴 ${who} ${forOther ? 'is' : 'are'} on holiday until ${back} (${igns}). The daily check skips ${forOther ? 'them' : 'you'} until then, and inactivity counts from the day ${forOther ? 'they' : 'you'}'re back.${forOther ? '' : ' Back early? `/away end`.'}`,
    };
  });
}

// ─── /help ───────────────────────────────────────────────────────────────────

/** Discord role that unlocks the staff commands (/warn, /map, /make-main, /whip, /lookup @user, /guide publish). */
export const LEADERSHIP_ROLE_ID = '1444749350285611038';
const ASSAULT_STAFF_ROLES = ['1457858504156250366', '1450584362264563855']; // Staff - Dream Engineers / Invaders

const MEMBER_HELP: [string, string[]][] = [
  ['💎 You', [
    '`/claim` link your Discord to the website and claim your character',
    '`/me` your daily check, streaks and stats (`share:True` posts it)',
    '`/away set days:` holiday up to 14 days, the daily check skips you · `/away end` · `/away list`',
    '`/lookup` your linked characters',
  ]],
  ['🏰 Guilds', [
    '`/guild tag:` requirement, raids, leaders and stats of a guild',
    '`/raid` raid times in your local time',
    '`/activity-bank` how the activity bank works',
    '`/leaderboard` activity ranks (week / month / all time, per guild)',
    '`/bumps` bump leaderboard',
    '`/guide show` links to the game guide',
  ]],
  ['⚔️ Assault', [
    '`/assault status` countdowns · `/assault last` last result · `/assault plan` kill order',
    '`/assault checklist` your prep checklist · `/assault potions` pick your loadout · `/assault loadout`',
    '`/assault top` · `/assault season` · `/assault zones` rankings',
    '`/assault conquest-info` how conquest works',
  ]],
];

const STAFF_HELP: [string, string[]][] = [
  [`🛡️ Leadership role <@&${LEADERSHIP_ROLE_ID}>`, [
    '`/warn user: reason:` warn and DM (only people ranked below you in game)',
    '`/map user: ign:` link a Discord user to a character (also syncs their guild roles)',
    '`/make-main ign:` set the main of an alt account',
    '`/lookup user:` anyone\'s linked characters',
    '`/guide publish` post or refresh the guide in this channel',
    '`/whip target:` 🔥',
  ]],
  ['🗓️ Officer+ in game', [
    '`/away set user:` / `/away end user:` holidays for people ranked below you',
  ]],
  [`⚔️ Assault staff ${ASSAULT_STAFF_ROLES.map((r) => `<@&${r}>`).join(' ')}`, [
    '`/assault toggle` · `/assault set-time` · `/assault set-zone` · `/assault ping-now` · `/assault skip-today`',
  ]],
  ['🤖 Automatic', [
    'Guild roles (Member/Staff - TAG, Retired Member) follow the game daily.',
    'Daily kick board in #daily-check, inactivity reports in guild chats, holidays in #holiday-log.',
  ]],
];

const section = ([name, lines]: [string, string[]]) => ({ name, value: lines.join('\n'), inline: false });

export function handleHelp(i: HubInteraction) {
  const roles = i.member?.roles ?? [];
  const isStaff = roles.includes(LEADERSHIP_ROLE_ID) || ASSAULT_STAFF_ROLES.some((r) => roles.includes(r));
  const all = i.data.options?.find((o) => o.name === 'staff')?.value === true;
  const embeds: Record<string, unknown>[] = [
    {
      title: '🤖 DreamBot commands',
      color: CRYSTAL,
      description: `Everything works in any channel; replies only you can see unless noted. Website: ${SITE}`,
      fields: MEMBER_HELP.map(section),
    },
  ];
  if (isStaff || all) {
    embeds.push({
      title: '🔒 Staff commands',
      color: 0xf59e0b,
      description: 'Staff actions only work on people ranked below you (super admin > leader > deputy > officer > member).',
      fields: STAFF_HELP.map(section),
    });
  } else {
    embeds[0].footer = { text: 'Staff commands: /help staff:True' };
  }
  return reply({ embeds, flags: EPHEMERAL });
}

// ─── Registration ────────────────────────────────────────────────────────────

export async function registerHubCommands() {
  const commands = [
    {
      name: 'help',
      description: 'Every DreamBot command, and which ones are for staff',
      options: [{ name: 'staff', type: 5, description: 'Also show the staff commands', required: false }],
    },
    { name: 'claim', description: 'Link your Discord to the Dream Guilds website and claim your character' },
    {
      name: 'me',
      description: 'Your daily check, streaks and stats',
      options: [{ name: 'share', type: 5, description: 'Post it in the channel instead of only showing you', required: false }],
    },
    {
      name: 'guild',
      description: 'Show a Dream guild: requirement, raids, leaders, stats',
      options: [{ name: 'tag', type: 3, description: 'Guild tag, e.g. DT', required: true, autocomplete: true }],
    },
    {
      name: 'away',
      description: 'Holiday: skip the inactivity check while you are away',
      options: [
        {
          name: 'set',
          type: 1,
          description: `Go on holiday (up to ${MAX_AWAY_DAYS} days)`,
          options: [
            { name: 'days', type: 4, description: 'Days away, including today', required: true, min_value: 1, max_value: MAX_AWAY_DAYS },
            { name: 'reason', type: 3, description: 'Optional, shown in #holiday-log', required: false, max_length: 200 },
            { name: 'user', type: 6, description: 'Staff: set it for someone ranked below you', required: false },
          ],
        },
        {
          name: 'end',
          type: 1,
          description: 'Back early: end the holiday',
          options: [{ name: 'user', type: 6, description: 'Staff: end it for someone ranked below you', required: false }],
        },
        { name: 'list', type: 1, description: 'Who is on holiday right now' },
      ],
    },
  ];
  const out: Record<string, { ok: boolean; error?: string }> = {};
  for (const c of commands) out[c.name] = await upsertGlobalCommand(c);
  return out;
}
