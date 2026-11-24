/**
 * Dream Hub Discord commands (step 8): /help, /claim, /me, /guild, /away; /profile (step 12); /kudos (step 14).
 * Routed from src/app/api/discord/interactions/route.ts. Registered with registerHubCommands().
 */
import { NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase-server';
import { editOriginalInteractionResponse, postToChannel, sendInteractionFollowup, upsertGlobalCommand } from '@/lib/discord-api';
import { getActiveClaim } from '@/lib/account-service';
import { getLinkByDiscord, linkUrl, mappedIgns, resolveDiscordLink } from '@/lib/discord-link';
import { buildMeSummary, type GuildGroup } from '@/lib/me-summary';
import { findGuildByTag, loadGuildDirectory } from '@/lib/guild-directory';
import { raidCls, req } from '@/lib/discord-posts';
import { gameGuildUrl } from '@/lib/live-messages';
import { GUIDE_SITE_URL } from '@/lib/game-guide';
import { ASSAULT_ENTRY_GUILD_ID, ASSAULT_TOP_GUILD_ID, ASSAULT_TOP_MIN_CL } from '@/lib/raids';
import { HOLIDAY_LOG_CHANNEL, MAX_AWAY_DAYS, awayUnix, endAway, getActiveAway, listActiveAway, setAway } from '@/lib/away';
import { outranks, outrankError, rankOfRole } from '@/lib/role-hierarchy';
import { achievementsField } from '@/lib/achievement-discord';
import { buildMeAssault } from '@/lib/me-assault';
import { personalRecapEmbed } from '@/lib/assault-recap';
import { buildProfile, findProfileAccount } from '@/lib/profile';
import { profilePath } from '@/lib/profile-path';
import { CHAR_BOARDS, NETWORK_BOARDS, getNetworkBoards, placeOf, type CharBoardKey, type NetworkBoardKey } from '@/lib/network-boards';
import { KUDOS_PER_WEEK, REASON_MAX, REASON_MIN, discordSafe, giveKudos, giverStatus, memberIdByIgn, receivedKudos } from '@/lib/kudos';
import { getAccountMemberIds } from '@/lib/alt-graph';
import { accountDiscordLevel, accountPass } from '@/lib/dream-pass-account';
import { chatChannels, memberChannels } from '@/lib/discord-chat';
import { PARTY_COMMAND_DEFS } from '@/lib/party-discord';
import { PARTY_STAFF_ROLE_ID } from '@/lib/party';
import { FIRST_SEASON, CHAT_COOLDOWN_S, CHAT_DAY_MIN, CHAT_MIN_CHARS, MAX_LEVEL, PASS_SOURCES, PASS_XP, SOURCE_ORDER, currentSeason, seasonEnd, seasonLabel, xpForLevel } from '@/lib/dream-pass';

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

// ─── Share button (replaces the old share:True option) ───────────────────────
// Personal cards reply privately with a "📢 Share" button; clicking it posts the same card publicly.
// custom_id = hubshare:<card>:<arg> (arg = IGN / season, ≤ 80 chars).

const SHARE_PREFIX = 'hubshare:';
export const HOW_ID = 'hubhow';
const howButton = () => ({ type: 2, style: 2, label: 'How it works', emoji: { name: 'ℹ️' }, custom_id: HOW_ID });
type Payload = Record<string, unknown>;

function withShare(payload: Payload, card: string, arg = ''): Payload {
  if (!payload.embeds) return payload; // errors / hints stay private, nothing to share
  const button = { type: 2, style: 2, label: 'Share', emoji: { name: '📢' }, custom_id: `${SHARE_PREFIX}${card}:${arg}`.slice(0, 100) };
  const rows = ((payload.components as Array<{ type: number; components: unknown[] }> | undefined) ?? []).map((r) => ({ ...r, components: [...r.components] }));
  if (rows[0] && rows[0].components.length < 5) rows[0].components.push(button);
  else rows.push(row(button));
  return { ...payload, components: rows };
}

/** Private reply with a Share button. */
function privateCard(i: HubInteraction, card: string, work: () => Promise<{ payload: Payload; arg?: string }>) {
  return deferred(i, true, async () => {
    const { payload, arg } = await work();
    return withShare(payload, card, arg ?? '');
  });
}

/** Share button clicked: post the card again, publicly, in the channel. */
export function handleHubShare(i: HubInteraction) {
  const u = caller(i);
  if (!u) return ephemeral('Could not identify you.');
  const id = String(i.data.custom_id ?? '').slice(SHARE_PREFIX.length);
  const card = id.split(':')[0]!;
  const arg = id.slice(card.length + 1);
  return deferred(i, false, async () => {
    const supabase = createAdminClient();
    const { payload } =
      card === 'me' ? await mePayload(supabase, u)
      : card === 'assault' ? await assaultMePayload(supabase, u, Number(arg) || undefined)
      : card === 'profile' ? await profilePayload(supabase, arg)
      : card === 'pass' ? await passPayload(supabase, arg.split('|')[0]!, arg.split('|')[1] || undefined)
      : card === 'level' ? await levelPayload(supabase, arg)
      : { payload: { content: 'This card can no longer be shared.' } };
    // Public copy: drop the private-only buttons (Share, How it works); keep the links.
    const rows = ((payload.components as Array<{ type: number; components: Array<{ custom_id?: string }> }> | undefined) ?? [])
      .map((r) => ({ ...r, components: r.components.filter((c) => !c.custom_id) }))
      .filter((r) => r.components.length);
    return { ...payload, components: rows };
  });
}

// ─── /claim ──────────────────────────────────────────────────────────────────

async function claimPayload(supabase: SupabaseClient, discordId: string, username: string) {
  const link = await resolveDiscordLink(supabase, discordId, username);
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
  return `**${tag}** · ${reqText} · ${state}\n-# ${g.members.map((m) => m.ign).join(', ')}`;
}

export function handleMe(i: HubInteraction) {
  const u = caller(i);
  if (!u) return ephemeral('Could not identify you.');
  return privateCard(i, 'me', () => mePayload(createAdminClient(), u));
}

type DiscordUser = { id: string; username: string; global_name?: string | null };

async function mePayload(supabase: SupabaseClient, u: DiscordUser): Promise<{ payload: Payload }> {
  const out = await (async (): Promise<Payload> => {
    const link = await resolveDiscordLink(supabase, u.id, u.global_name ?? u.username);
    if (!link) return { content: 'Your Discord is not linked to a website account yet. Run `/claim` first.' };
    const s = await buildMeSummary(link.user_id, {}, supabase);
    if (!s.claimed) {
      return {
        content: s.pending ? `⏳ Your claim on **${s.pending.ign}** is waiting for an officer.` : 'No character claimed yet. Claim your main on the site.',
        components: [row(linkButton('My characters', `${SITE}/account`))],
      };
    }
    const [away, ach] = await Promise.all([
      getActiveAway(supabase, u.id),
      achievementsField(supabase, s.characters.map((c) => c.member_id), link.user_id).catch(() => null),
    ]);
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
          title: `${s.main.ign}${ach?.title ? ` · ${ach.title}` : ''}${s.main.guild_nickname ? ` · ${s.main.guild_nickname}` : ''}`,
          url: `${SITE}/me`,
          color: CRYSTAL,
          thumbnail: s.main.avatar_url ? { url: s.main.avatar_url } : undefined,
          description: lines.join('\n'),
          fields: [
            { name: 'Lifetime gold', value: fmt(s.tiles.lifetime_gold), inline: true },
            { name: 'Raids', value: fmt(s.tiles.lifetime_raids), inline: true },
            { name: 'Days met', value: `${fmt(s.tiles.days_met)} / ${fmt(s.tiles.days_logged)}`, inline: true },
            { name: 'Streak', value: `🔥 ${s.streak.current}d · best ${s.streak.best}d`, inline: true },
            ...(s.tiles.assault_runs ? [{ name: 'Assault kills', value: fmt(s.tiles.assault_kills), inline: true }] : []),
            ...(ach ? [{ name: ach.name, value: ach.value, inline: false }] : []),
            { name: 'Characters', value: s.characters.map((c) => c.ign).join(', ').slice(0, 1000) || '—', inline: false },
          ],
        },
      ],
      components: [row(linkButton('Open my dashboard', `${SITE}/me`))],
    };
  })();
  return { payload: out };
}

// ─── /assault me [season] (step 10) ──────────────────────────────────

export function handleAssaultMe(i: HubInteraction) {
  const u = caller(i);
  if (!u) return ephemeral('Could not identify you.');
  const season = Number(i.data.options?.find((o) => o.name === 'season')?.value) || undefined;
  return privateCard(i, 'assault', async () => ({ ...(await assaultMePayload(createAdminClient(), u, season)), arg: season ? String(season) : '' }));
}

async function assaultMePayload(supabase: SupabaseClient, u: DiscordUser, season?: number): Promise<{ payload: Payload }> {
  const link = await resolveDiscordLink(supabase, u.id, u.global_name ?? u.username);
  if (!link) return { payload: { content: 'Your Discord is not linked to a website account yet. Run `/claim` first.' } };
  const a = await buildMeAssault(link.user_id, supabase, { season });
  if (!a.claimed) return { payload: { content: 'No character claimed yet. Run `/claim`.', components: [row(linkButton('My characters', `${SITE}/account`))] } };
  const { data: claim } = await supabase.from('user_characters').select('member:members(ign)').eq('user_id', link.user_id).eq('status', 'approved').limit(1).maybeSingle();
  const m = (claim as { member?: { ign?: string } | { ign?: string }[] } | null)?.member;
  const who = (Array.isArray(m) ? m[0]?.ign : m?.ign) ?? u.global_name ?? u.username;
  return {
    payload: {
      embeds: [personalRecapEmbed(a, who)],
      components: [row(linkButton('Open My assault', `${SITE}/me/assault${a.season !== a.current_season ? `?season=${a.season}` : ''}`))],
    },
  };
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

// ─── /profile [ign|user] (step 12) ───────────────────────────────────

export async function handleProfileAutocomplete(i: HubInteraction) {
  const q = String(i.data.options?.find((o) => o.focused)?.value ?? '').trim();
  const supabase = createAdminClient();
  let query = supabase.from('members').select('ign, current_guild_id, is_active').order('is_active', { ascending: false }).order('total_level', { ascending: false }).limit(25);
  if (q) query = query.ilike('ign', `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  const [{ data }, { data: guilds }] = await Promise.all([query, supabase.from('guilds').select('id, nickname')]);
  const tag = new Map((guilds ?? []).map((g) => [g.id as string, g.nickname as string | null]));
  const choices = (data ?? []).map((m) => ({
    name: `${m.ign}${m.is_active && m.current_guild_id && tag.get(m.current_guild_id) ? ` · ${tag.get(m.current_guild_id)}` : ''}`.slice(0, 100),
    value: m.ign,
  }));
  return NextResponse.json({ type: 8, data: { choices } });
}

export function handleProfile(i: HubInteraction) {
  const u = caller(i);
  if (!u) return ephemeral('Could not identify you.');
  const opt = (n: string) => i.data.options?.find((o) => o.name === n)?.value;
  const ignOpt = String(opt('ign') ?? '').trim();
  const target = (opt('user') as string | undefined) ?? (ignOpt ? null : u.id);
  return privateCard(i, 'profile', async () => {
    const supabase = createAdminClient();
    const acc = await resolveAccount(supabase, u, ignOpt, target);
    if ('error' in acc) return { payload: { content: acc.error } };
    return { ...(await profilePayload(supabase, acc.ign)), arg: acc.ign };
  });
}

async function profilePayload(supabase: SupabaseClient, ign: string): Promise<{ payload: Payload }> {
    const account = await findProfileAccount(ign, supabase);
  if (!account) return { payload: { content: `No Dream character called **${ign}**.` } };
  const p = await buildProfile(account, '', supabase);
  const a = p.achievements;
  const streaks = p.streak.current > 0 || p.streak.best > 0 ? `🔥 ${p.streak.current}d (best ${p.streak.best}d)` : '';
  const badges = a.achievements
    .filter((x) => x.unlocked_at)
    .sort((x, y) => (x.unlocked_at! < y.unlocked_at! ? 1 : -1))
    .slice(0, 4)
    .map((x) => `${({ bronze: '🥉', silver: '🥈', gold: '🥇', crystal: '💎', dream: '🌌' } as const)[x.tier]} ${x.name}`)
    .join(' · ');
  const m = p.main;
  const head = [
    [m.combat_level != null ? `CL ${m.combat_level}` : null, `Lv ${fmt(m.total_level ?? 0)}`, m.class ? m.class.charAt(0) + m.class.slice(1).toLowerCase() : null]
      .filter(Boolean)
      .join(' · '),
    m.in_dream_guild ? `${m.guild_name}${m.position && m.position !== 'MEMBER' ? ` (${m.position.charAt(0) + m.position.slice(1).toLowerCase()})` : ''}` : 'Not in a Dream guild',
    `${a.rank ? `${a.rank.emoji} **${a.rank.name}** · ` : ''}${fmt(a.xp)} Dream XP · ${a.unlocked}/${a.total} achievements`,
  ];
  const url = `${SITE}${profilePath(p.ign)}`;
  return { payload: {
    embeds: [
      {
        title: `${p.ign}${a.title ? ` · ${a.title.name}` : ''}`,
        url,
        color: CRYSTAL,
        thumbnail: m.avatar_url ? { url: m.avatar_url } : undefined,
        description: head.join('\n'),
        fields: [
          { name: 'Lifetime gold', value: fmt(p.tiles.lifetime_gold), inline: true },
          { name: 'Raids', value: fmt(p.tiles.lifetime_raids), inline: true },
          { name: 'Days met', value: `${fmt(p.tiles.days_met)} / ${fmt(p.tiles.days_logged)}`, inline: true },
          ...(p.tiles.assault_runs
            ? [{ name: 'Assault', value: `${fmt(p.tiles.assault_kills)} kills · ${fmt(p.tiles.assault_runs)} waves`, inline: true }]
            : []),
          ...(streaks ? [{ name: 'Streak', value: streaks.slice(0, 1000), inline: false }] : []),
          ...(badges ? [{ name: 'Latest achievements', value: badges.slice(0, 1000), inline: false }] : []),
          ...(p.kudos.total
            ? [{ name: '💎 Kudos', value: `${fmt(p.kudos.total)} from ${p.kudos.givers} member${p.kudos.givers === 1 ? '' : 's'}${p.kudos.recent[0] ? `\n> “${discordSafe(p.kudos.recent[0].reason)}” · ${discordSafe(p.kudos.recent[0].from_ign)}` : ''}`.slice(0, 1000), inline: false }]
            : []),
          ...(p.characters.length > 1
            ? [{ name: 'Characters', value: p.characters.map((c) => c.ign).join(', ').slice(0, 1000), inline: false }]
            : []),
        ],
      },
    ],
    components: [row(linkButton('Open profile', url))],
  } };
}

// ─── /pass (step 15, Dream Pass) ─────────────────────────────────────────────

const bar = (value: number, max: number, width = 12) => {
  const n = max > 0 ? Math.round(Math.min(1, value / max) * width) : 0;
  return '▰'.repeat(n) + '▱'.repeat(width - n);
};

/** Account (member ids + main IGN) for /profile-style options: ign, user, or the caller. */
async function resolveAccount(supabase: SupabaseClient, u: { id: string; username: string; global_name?: string | null }, ignOpt: string, target: string | null) {
  let ign = ignOpt;
  if (!ign && target) {
    const link = target === u.id ? await resolveDiscordLink(supabase, u.id, u.global_name ?? u.username) : await getLinkByDiscord(supabase, target);
    const claim = link ? await getActiveClaim(link.user_id, supabase) : null;
    ign = claim?.status === 'approved' ? claim.ign : (await mappedIgns(supabase, target))[0] ?? '';
    if (!ign) return { error: target === u.id ? 'You have no linked character yet. Run `/claim`.' : `<@${target}> has no linked character.` };
  }
  const account = await findProfileAccount(ign, supabase);
  if (!account) return { error: `No Dream character called **${ign}**.` };
  // Show the name that was asked for, in its stored spelling.
  const hit = account.characters.find((c) => c.ign.toLowerCase() === ign.toLowerCase()) ?? account.characters[0]!;
  return { ids: account.characters.map((c) => c.member_id), ign: hit.ign };
}

/** ℹ️ How it works button (custom_id hubhow): how to earn XP + which channels count for chat XP. Always private. */
export function handlePassHow(i: HubInteraction) {
  return deferred(i, true, async () => {
    const supabase = createAdminClient();
    // Live channel list from Discord; fall back to the channels already being read.
    const live = await memberChannels().then((c) => c.map((x) => ({ id: x.id, name: x.name }))).catch(() => null);
    const channels = live ?? (await chatChannels(supabase));
    const mentions = channels.map((c) => `<#${c.id}>`).join(' ');
    return {
      embeds: [
        {
          title: '🎟️ How the Dream Pass works',
          color: CRYSTAL,
          description: [
            `Every calendar month is a season: earn XP, climb ${MAX_LEVEL} levels (${fmt(xpForLevel(MAX_LEVEL))} XP), then ⭐ every 100 XP. Your alts count as one account. Top 10 at month end = **Season Champion** role. Everything also adds to lifetime **Dream XP**, which sets your rank role.`,
            '',
            ...SOURCE_ORDER.map((k) => `${PASS_SOURCES[k].emoji} **${PASS_SOURCES[k].label}** · ${PASS_SOURCES[k].hint}`),
          ].join('\n'),
          fields: [
            {
              name: '💬 Chat XP rules',
              value: [
                `A message counts if it has ${CHAT_MIN_CHARS}+ characters (or an image/sticker), ${CHAT_COOLDOWN_S} s after your last counted one (any channel).`,
                `${CHAT_DAY_MIN}+ counted messages in a day = a chat day (5 pass XP). Every counted message + every bump = 1 Discord XP for your Discord level.`,
                'Your Discord must be linked (`/claim`) for it to reach your pass; messages are kept and join once you link.',
              ].join('\n'),
              inline: false,
            },
            { name: `📍 Channels that count (${channels.length})`, value: mentions.slice(0, 1024) || '_none yet_', inline: false },
          ],
          footer: { text: 'Staff, bot and other-game channels do not count · XP updates daily after the activity check' },
        },
      ],
    };
  });
}

export function handlePass(i: HubInteraction) {
  const u = caller(i);
  if (!u) return ephemeral('Could not identify you.');
  const opt = (n: string) => i.data.options?.find((o) => o.name === n)?.value;
  const ignOpt = String(opt('ign') ?? '').trim();
  const target = (opt('user') as string | undefined) ?? (ignOpt ? null : u.id);
  const seasonOpt = String(opt('month') ?? '').trim();
  const season = /^\d{4}-\d{2}$/.test(seasonOpt) ? seasonOpt : undefined;
  return privateCard(i, 'pass', async () => {
    const supabase = createAdminClient();
    const acc = await resolveAccount(supabase, u, ignOpt, target);
    if ('error' in acc) return { payload: { content: acc.error } };
    return { ...(await passPayload(supabase, acc.ign, season)), arg: `${acc.ign}|${season ?? ''}` };
  });
}

/** Month autocomplete for /pass month: (finished seasons + the running one). */
export async function handlePassAutocomplete(i: HubInteraction) {
  const q = String(i.data.options?.find((o) => o.focused)?.value ?? '').toLowerCase();
  const supabase = createAdminClient();
  const { data } = await supabase.from('dream_pass_seasons').select('season').gte('season', FIRST_SEASON).order('season', { ascending: false }).limit(24);
  const seasons = [currentSeason(), ...(data ?? []).map((r) => r.season as string)];
  const choices = seasons
    .map((s, idx) => ({ name: `${seasonLabel(s)}${idx === 0 ? ' (this month)' : ''}`, value: s }))
    .filter((c) => !q || c.name.toLowerCase().includes(q) || c.value.includes(q))
    .slice(0, 25);
  return NextResponse.json({ type: 8, data: { choices } });
}

async function passPayload(supabase: SupabaseClient, ign: string, season?: string): Promise<{ payload: Payload }> {
  const account = await findProfileAccount(ign, supabase);
  if (!account) return { payload: { content: `No Dream character called **${ign}**.` } };
  const p = await accountPass(supabase, account.characters.map((c) => c.member_id), season);
  const live = p.season === currentSeason();
  const lv = p.level;
  const left = Math.max(0, Math.ceil((Date.parse(`${seasonEnd(p.season)}T00:00:00Z`) - Date.now()) / 86_400_000));
  const sources = SOURCE_ORDER.filter((k) => (p.breakdown[k] ?? 0) > 0)
    .sort((a, b) => (p.breakdown[b] ?? 0) - (p.breakdown[a] ?? 0))
    .map((k) => `${PASS_SOURCES[k].emoji} ${PASS_SOURCES[k].label} **${fmt(p.breakdown[k] ?? 0)}**`);
  const levelLine = `**Level ${lv.level}**${lv.stars ? ` ★${lv.stars}` : ''} · ${fmt(p.xp)} XP${live ? `\n${bar(lv.into, lv.need)} ${fmt(lv.need - lv.into)} to ${lv.level >= MAX_LEVEL ? 'next ★' : `level ${lv.level + 1}`}` : ''}`;
  const champ = p.champion.find((c) => c.season === p.season);
  const placeLine = p.place
    ? `#${p.place} of ${p.players} ${live ? 'this season' : 'that season'}${live && p.place <= 10 ? ' · 🏆 champion pace' : ''}${champ ? ' · 🏆 Season Champion' : ''}`
    : `_No XP ${live ? 'yet this season' : 'that month'}._`;
  const url = `${SITE}${profilePath(ign)}`;
  return {
    payload: {
      embeds: [
        {
          title: `🎟️ Dream Pass · ${ign}`,
          url,
          color: CRYSTAL,
          description: [`${seasonLabel(p.season)}${live ? ` · ${left} day${left === 1 ? '' : 's'} left` : ' · finished'}`, levelLine, placeLine].join('\n'),
          fields: [
            ...(sources.length ? [{ name: live ? 'This season' : 'That season', value: sources.join('\n').slice(0, 1000), inline: false }] : []),
            {
              name: '🌌 Lifetime Dream XP',
              value: `${fmt(p.lifetime)}${p.lifetime_place ? ` (#${p.lifetime_place})` : ''}\n${p.rank ? `${p.rank.emoji} **${p.rank.name}**` : 'No rank yet'}${p.next_rank ? ` · ${fmt(p.next_rank.min - p.lifetime)} to ${p.next_rank.name}` : ''}`,
              inline: true,
            },
            {
              name: '💬 Discord level',
              value: p.discord.linked ? `**${p.discord.level}** · \`/level\` for details` : 'Not linked: `/claim`',
              inline: true,
            },
            ...(p.champion.length ? [{ name: '🏆 Season Champion', value: p.champion.map((c) => `${seasonLabel(c.season)} #${c.place}`).join(' · ').slice(0, 1000), inline: false }] : []),
            ...(live && p.previous ? [{ name: 'Last season', value: `${seasonLabel(p.previous.season)}: level ${p.previous.level} · ${fmt(p.previous.xp)} XP`, inline: false }] : []),
          ],
          footer: { text: 'Assaults are worth the most · alts pooled · ℹ️ How it works for the rules · month: for past months' },
        },
      ],
      components: [row(linkButton('Open profile', url), linkButton('Season board', `${SITE}/leaderboard`), howButton())],
    },
  };
}

// ─── /level (step 15b, Discord level) ────────────────────────────────────────

export function handleLevel(i: HubInteraction) {
  const u = caller(i);
  if (!u) return ephemeral('Could not identify you.');
  const opt = (n: string) => i.data.options?.find((o) => o.name === n)?.value;
  const ignOpt = String(opt('ign') ?? '').trim();
  const target = (opt('user') as string | undefined) ?? (ignOpt ? null : u.id);
  return privateCard(i, 'level', async () => {
    const supabase = createAdminClient();
    const acc = await resolveAccount(supabase, u, ignOpt, target);
    if ('error' in acc) return { payload: { content: acc.error } };
    return { ...(await levelPayload(supabase, acc.ign)), arg: acc.ign };
  });
}

async function levelPayload(supabase: SupabaseClient, ign: string): Promise<{ payload: Payload }> {
  const account = await findProfileAccount(ign, supabase);
  if (!account) return { payload: { content: `No Dream character called **${ign}**.` } };
  const ids = account.characters.map((c) => c.member_id);
  const d = await accountDiscordLevel(supabase, ids);
  if (!d.linked) return { payload: { content: `**${ign}** has no Discord linked yet, so no Discord level. Link it with \`/claim\`.` } };
  const boards = await getNetworkBoards();
  const key = ids.slice().sort()[0];
  const idx = boards.boards.discord.findIndex((r) => r.key === key);
  const place = idx >= 0 ? placeOf(boards.boards.discord, idx) : null;
  return {
    payload: {
      embeds: [
        {
          title: `💬 Discord level · ${ign}`,
          url: `${SITE}${profilePath(ign)}`,
          color: 0x818cf8,
          description: [
            `**Level ${d.level}** · ${fmt(d.xp)} Discord XP${place ? ` · #${place} in the server` : ''}`,
            `${bar(d.into, d.need)} ${fmt(d.need - d.into)} to level ${d.level + 1}`,
            '',
            `💬 ${fmt(d.messages)} counted messages · 📣 ${fmt(d.bumps)} bumps · 📅 ${fmt(d.chat_days_month)} chat days this month (+${fmt(d.chat_days_month * PASS_XP.chatDay)} Dream Pass XP)`,
          ].join('\n'),
          footer: { text: `1 XP per message (${CHAT_MIN_CHARS}+ chars, ${CHAT_COOLDOWN_S} s apart) or bump · ℹ️ How it works lists the channels that count` },
        },
      ],
      components: [row(linkButton('Discord level board', `${SITE}/leaderboard`), howButton())],
    },
  };
}

// ─── /leaderboard board: (step 13) ───────────────────────────────────────────

const MEDALS = ['🥇', '🥈', '🥉'];

export function handleNetworkBoard(i: HubInteraction, boardRaw: unknown, perCharRaw = false) {
  const board = String(boardRaw) as NetworkBoardKey;
  const meta = NETWORK_BOARDS[board];
  if (!meta) return ephemeral('Unknown board.');
  // Dream XP / Discord level / Dream Pass are always per account.
  const perChar = perCharRaw && (CHAR_BOARDS as string[]).includes(board);
  return deferred(i, false, async () => {
    const data = await getNetworkBoards();
    const all = perChar ? data.char_boards[board as CharBoardKey] : data.boards[board];
    const rows = all.slice(0, 10);
    const lines = rows.map((r, idx) => {
      const place = placeOf(all, idx);
      const alts = r.main_ign ? ` (alt of ${r.main_ign})` : r.alt_igns.length ? ` (+${r.alt_igns.length})` : '';
      const tag = r.guild_nickname ? ` · ${r.guild_nickname}` : '';
      const value =
        board === 'improved'
          ? `+${fmt(r.value)} (${fmt(r.before ?? 0)} → ${fmt(r.after ?? 0)})`
          : board === 'dream_xp'
            ? `${fmt(r.value)} XP${r.rank_emoji ? ` ${r.rank_emoji} ${r.rank_name}` : ''}`
            : board === 'pass'
              ? `Lv ${r.level ?? 0}${r.stars ? ` ★${r.stars}` : ''} · ${fmt(r.value)} XP`
              : board === 'discord'
                ? `Lv ${r.level ?? 0} · ${fmt(r.value)} XP`
            : `${r.value} day${r.value === 1 ? '' : 's'}`;
      return `${MEDALS[place - 1] ?? `**${place}.**`} **${r.ign}**${alts}${tag} · ${value}`;
    });
    const url = `${SITE}/leaderboard`;
    return {
      embeds: [
        {
          title: `${meta.emoji} ${meta.label}`,
          url,
          color: CRYSTAL,
          description: [meta.description, '', ...(lines.length ? lines : ['_Nobody on this board yet._'])].join('\n').slice(0, 4000),
          footer: { text: perChar ? 'All Dream guilds · every character on its own' : 'All Dream guilds · alts pooled into one account' },
        },
      ],
      components: [row(linkButton('Full leaderboard', url))],
    };
  });
}

// ─── /kudos give|me (step 14, F7) ────────────────────────────────────────────

/** IGN autocomplete inside the `give` subcommand (same list as /profile). */
export function handleKudosAutocomplete(i: HubInteraction) {
  const sub = i.data.options?.[0];
  return handleProfileAutocomplete({ ...i, data: { ...i.data, options: sub?.options ?? [] } });
}

/** Character the caller means: ign option, else the Discord user's claimed main / mapped character. */
async function kudosTarget(supabase: SupabaseClient, ign: string, userId: string | undefined) {
  if (ign) return memberIdByIgn(supabase, ign);
  if (!userId) return null;
  const link = await getLinkByDiscord(supabase, userId);
  const claim = link ? await getActiveClaim(link.user_id, supabase) : null;
  if (claim?.status === 'approved') return { id: claim.member_id as string, ign: claim.ign };
  const mapped = (await mappedIgns(supabase, userId))[0];
  return mapped ? memberIdByIgn(supabase, mapped) : null;
}

export function handleKudos(i: HubInteraction) {
  const u = caller(i);
  if (!u) return ephemeral('Could not identify you.');
  const sub = i.data.options?.[0];
  const opt = (n: string) => sub?.options?.find((o) => o.name === n)?.value;

  // Validation answers stay private; a successful kudos is posted publicly as a follow-up.
  return deferred(i, true, async () => {
    const supabase = createAdminClient();
    const link = await resolveDiscordLink(supabase, u.id, u.global_name ?? u.username);

    if (sub?.name === 'me') {
      if (!link) return { content: 'Your Discord is not linked yet. Run `/claim` first.' };
      const claim = await getActiveClaim(link.user_id, supabase);
      if (claim?.status !== 'approved') return { content: 'Claim your character first (`/claim`).' };
      const ids = Array.from(await getAccountMemberIds(supabase, [claim.member_id as string]));
      const [status, got] = await Promise.all([giverStatus(supabase, link.user_id), receivedKudos(supabase, ids, 5)]);
      const reset = Math.floor(Date.parse(status.resets_at) / 1000);
      const lines = [
        `💎 **${status.remaining} of ${KUDOS_PER_WEEK}** kudos left to give this week · resets <t:${reset}:R>`,
        ...status.given.map((k) => `• to **${discordSafe(k.recipient_ign)}**: “${discordSafe(k.reason)}”`),
        '',
        `**Received:** ${got.total} kudos from ${got.givers} member${got.givers === 1 ? '' : 's'}${got.this_week ? ` · ${got.this_week} this week` : ''}`,
        ...got.recent.map((k) => `> “${discordSafe(k.reason)}” · ${discordSafe(k.from_ign)} <t:${Math.floor(Date.parse(k.at) / 1000)}:R>`),
      ];
      return { content: lines.join('\n').slice(0, 1990), components: [row(linkButton('My profile', `${SITE}${profilePath(claim.ign)}`))] };
    }

    // give
    if (!link) return { content: 'Link your Discord first with `/claim`, then you can give kudos.' };
    const ign = String(opt('ign') ?? '').trim();
    const userOpt = opt('user') as string | undefined;
    if (!ign && !userOpt) return { content: 'Pick who gets the kudos: `user:` or `ign:`.' };
    if (!String(opt('reason') ?? '').trim()) return { content: 'Add a `reason:`: what are you thanking them for?' };
    const target = await kudosTarget(supabase, ign, userOpt);
    if (!target) return { content: ign ? `No Dream character called **${discordSafe(ign)}**.` : `<@${userOpt}> has no linked character yet.` };

    const res = await giveKudos(supabase, { giverUserId: link.user_id, recipientMemberId: target.id, reason: String(opt('reason') ?? ''), source: 'discord' });
    if (!res.ok) return { content: `❌ ${res.error}` };

    const who = res.recipient_discord_id ? `<@${res.recipient_discord_id}> (**${discordSafe(res.recipient_ign)}**)` : `**${discordSafe(res.recipient_ign)}**`;
    const posted = await sendInteractionFollowup(i.application_id, i.token, {
      content: `💎 **${discordSafe(res.giver_ign)}** gave kudos to ${who}\n> ${discordSafe(res.kudos.reason)}\n-# \`/kudos give\` to thank someone · ${KUDOS_PER_WEEK} per week · weekly shoutout in #hall-of-fame`,
      allowed_mentions: { users: res.recipient_discord_id ? [res.recipient_discord_id] : [] },
    });
    return {
      content: `✅ Kudos sent to **${discordSafe(res.recipient_ign)}**. ${res.remaining} left this week.${posted.ok ? '' : ' (Could not post it in this channel, but it counts.)'}`,
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
    '`/me` your daily check, streaks and stats',
    '`/profile` someone\'s profile (`ign:` or `user:`, empty = yours): rank, achievements, stats',
    '`/pass` your Dream Pass: season level and XP per source (`month:` for past months, ℹ️ button: how to earn + which channels count)',
    '`/level` your Discord level from chatting and bumping',
    '-# Personal cards reply privately; press 📢 **Share** to post them in the channel.',
    '`/away set days:` holiday up to 14 days, the daily check skips you · `/away end` · `/away list`',
    '`/kudos give user:`/`ign:` `reason:` thank someone (3 per week, weekly shoutout) · `/kudos me` yours',
    '`/lookup` your linked characters',
  ]],
  ['🏰 Guilds', [
    '`/guild tag:` requirement, raids, leaders and stats of a guild',
    '`/raid` raid times in your local time',
    '`/activity-bank` how the activity bank works',
    '`/leaderboard` Dream Pass board of this month · `board:` Discord level, activity (week / month / all time, per guild or class), streaks, most improved, Dream XP',
    '`/guide show` links to the game guide',
  ]],
  ['🎉 Parties & leagues', [
    '`/league list` running and upcoming leagues · `/lfg set ign:` list a character as looking for a party (14 days, once per alt) · `/lfg clear`',
    '`/party create name: ign:` list your in-game party (inside your #league-party-find thread to use it) · `/party invite ign:` (alts too, one party per character) · `/party league` plan / joined · `/party edit slayer:` · `/party leave` · `/party close`',
    '-# Everything shows on the 📋 Party board in #league-party-find.',
  ]],
  ['⚔️ Assault', [
    '`/assault status` countdowns · `/assault last` last result · `/assault plan` kill order',
    '`/assault me` your assault season + recap · `/assault checklist` your prep checklist · `/assault potions` pick your loadout · `/assault loadout`',
    '`/assault top` · `/assault season` · `/assault zones` rankings',
    '`/assault conquest-info` how conquest works',
  ]],
];

const STAFF_HELP: [string, string[]][] = [
  [`🛡️ Leadership role <@&${LEADERSHIP_ROLE_ID}>`, [
    '`/warn user: reason:` warn and DM (only people ranked below you in game)',
    '`/map ign: user:` link a character to a Discord user (also syncs their guild roles)',
    '`/make-main ign:` set the main of an alt account',
    '`/lookup user:` anyone\'s linked characters',
    '`/guide publish` post or refresh the guide in this channel',
    '`/bumps` bump leaderboard',
    '`/whip target:` 🔥',
  ]],
  ['🎉 Party finder (supreme staff)', [
    '`/league import` paste the in-game league list · `/league restrict` cursed/restricted/forsaken/banished · `/league remove` · `/league board` create/repair the board',
    '`/party create leader:` attach a thread for someone · `/party verify` 💤 Dream party',
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
  const isStaff = roles.includes(LEADERSHIP_ROLE_ID) || roles.includes(PARTY_STAFF_ROLE_ID) || ASSAULT_STAFF_ROLES.some((r) => roles.includes(r));
  const embeds: Record<string, unknown>[] = [
    {
      title: '🤖 DreamBot commands',
      color: CRYSTAL,
      description: `Everything works in any channel; replies only you can see unless noted. Website: ${SITE}`,
      fields: MEMBER_HELP.map(section),
    },
  ];
  // Staff section only for people with the Leadership or an assault staff role.
  if (isStaff) {
    embeds.push({
      title: '🔒 Staff commands',
      color: 0xf59e0b,
      description: 'Staff actions only work on people ranked below you (super admin > leader > deputy > officer > member).',
      fields: STAFF_HELP.map(section),
    });
  }
  return reply({ embeds, flags: EPHEMERAL });
}

// ─── Registration ────────────────────────────────────────────────────────────

export async function registerHubCommands() {
  const commands = [
    { name: 'help', description: 'Every DreamBot command (staff see their commands too)' },
    { name: 'claim', description: 'Link your Discord to the Dream Guilds website and claim your character' },
    {
      name: 'me',
      description: 'Your daily check, streaks and stats (📢 Share button posts it)',
    },
    {
      name: 'profile',
      description: "A member's profile: rank, achievements, stats (yours if empty)",
      options: [
        { name: 'ign', type: 3, description: 'Character name (any character of the account)', required: false, autocomplete: true },
        { name: 'user', type: 6, description: 'Discord member', required: false },
      ],
    },
    {
      name: 'pass',
      description: 'Dream Pass: season level, XP per source, lifetime Dream XP (yours if empty)',
      options: [
        { name: 'ign', type: 3, description: 'Character name (any character of the account)', required: false, autocomplete: true },
        { name: 'user', type: 6, description: 'Discord member', required: false },
        { name: 'month', type: 3, description: 'A past month (default: this month)', required: false, autocomplete: true },
      ],
    },
    {
      name: 'level',
      description: 'Discord level: chat messages and bumps in the Dream server (yours if empty)',
      options: [
        { name: 'ign', type: 3, description: 'Character name (any character of the account)', required: false, autocomplete: true },
        { name: 'user', type: 6, description: 'Discord member', required: false },
      ],
    },
    {
      name: 'guild',
      description: 'Show a Dream guild: requirement, raids, leaders, stats',
      options: [{ name: 'tag', type: 3, description: 'Guild tag, e.g. DT', required: true, autocomplete: true }],
    },
    {
      name: 'kudos',
      description: 'Thank a member: kudos with a short reason (3 per week)',
      options: [
        {
          name: 'give',
          type: 1,
          description: 'Give someone kudos (3 per week, one per person)',
          options: [
            // All optional so Discord keeps this order (required options always come first);
            // the handler insists on a target and giveKudos on the reason.
            { name: 'user', type: 6, description: 'Discord member to thank', required: false },
            { name: 'ign', type: 3, description: 'Or their character name', required: false, autocomplete: true },
            { name: 'reason', type: 3, description: 'What are you thanking them for? (required)', required: false, min_length: REASON_MIN, max_length: REASON_MAX },
          ],
        },
        { name: 'me', type: 1, description: 'Kudos you have left this week and the ones you received' },
      ],
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
  commands.push(...(PARTY_COMMAND_DEFS as typeof commands));
  const out: Record<string, { ok: boolean; error?: string }> = {};
  for (const c of commands) out[c.name] = await upsertGlobalCommand(c);
  return out;
}
