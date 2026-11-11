import { NextRequest, NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { createAdminClient } from '@/lib/supabase-server';
import { verifyDiscordSignature, sendDirectMessage, registerWarnCommand, registerMapCommand, registerAltCommand, registerActivityBankCommand, registerWhipCommand, registerLeaderboardCommand, registerBumpsCommand, sendInteractionFollowup, editOriginalInteractionResponse, editChannelMessageRich, postToChannel, listGlobalCommands, listGuildCommands, deleteGlobalCommand, deleteGuildCommand } from '@/lib/discord-api';
import { switchAccountMain } from '@/lib/alt-switch';
import { fetchLeaderboard, type LeaderboardFilter, type LeaderboardPeriod } from '@/lib/leaderboard';
import { formatLeaderboard } from '@/lib/utils';
import {
  COOLDOWN_MS,
  buildBumpMessage,
  countBumpsForUser,
  displayName,
  formatCooldown,
  getAllTimeLeaderboard,
  getLastBumpMs,
  getMonthlyLeaderboard,
  getMonthlyLeaderboardWithStreaks,
  getRecentBumps,
  getStreakLeaderboard,
  getUserStreak,
  insertBump,
  medal,
  readBumpConfig,
} from '@/lib/bump-stats';

export const dynamic = 'force-dynamic';

const INTERACTION_TYPE_PING = 1;
const INTERACTION_TYPE_COMMAND = 2;
const INTERACTION_TYPE_COMPONENT = 3;
const INTERACTION_TYPE_AUTOCOMPLETE = 4;

// GET /api/discord/interactions
// ?action=register → register /warn slash command (one-time setup)
// no params → health check (Discord pre-validates endpoint with GET)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get('action') === 'register') {
    const result = await registerWarnCommand();
    return NextResponse.json(result);
  }
  if (searchParams.get('action') === 'register-map') {
    const result = await registerMapCommand();
    return NextResponse.json(result);
  }
  if (searchParams.get('action') === 'register-activity-bank') {
    const result = await registerActivityBankCommand();
    return NextResponse.json(result);
  }
  if (searchParams.get('action') === 'register-whip') {
    const result = await registerWhipCommand();
    return NextResponse.json(result);
  }
  if (searchParams.get('action') === 'register-leaderboard') {
    const result = await registerLeaderboardCommand();
    return NextResponse.json(result);
  }
  if (searchParams.get('action') === 'register-alt') {
    const result = await registerAltCommand();
    return NextResponse.json(result);
  }
  if (searchParams.get('action') === 'list-commands') {
    const guildId = searchParams.get('guild_id');
    const result = guildId ? await listGuildCommands(guildId) : await listGlobalCommands();
    return NextResponse.json(result);
  }
  if (searchParams.get('action') === 'delete-command') {
    const id = searchParams.get('id');
    const guildId = searchParams.get('guild_id');
    if (!id) return NextResponse.json({ error: 'id query param required' }, { status: 400 });
    const result = guildId ? await deleteGuildCommand(guildId, id) : await deleteGlobalCommand(id);
    return NextResponse.json(result);
  }
  if (searchParams.get('action') === 'reset-alt') {
    // Wipe every command named 'alt' (both global + optional guild scope), then register fresh.
    const guildId = searchParams.get('guild_id');
    const globalList = await listGlobalCommands();
    const deleted: Array<{ scope: string; id: string }> = [];
    for (const c of globalList.commands ?? []) {
      if (c.name === 'alt') {
        const r = await deleteGlobalCommand(c.id);
        if (r.ok) deleted.push({ scope: 'global', id: c.id });
      }
    }
    if (guildId) {
      const guildList = await listGuildCommands(guildId);
      for (const c of guildList.commands ?? []) {
        if (c.name === 'alt') {
          const r = await deleteGuildCommand(guildId, c.id);
          if (r.ok) deleted.push({ scope: `guild:${guildId}`, id: c.id });
        }
      }
    }
    const reg = await registerAltCommand();
    return NextResponse.json({ deleted, register: reg });
  }
  if (searchParams.get('action') === 'register-bumps') {
    const result = await registerBumpsCommand();
    return NextResponse.json(result);
  }
  return NextResponse.json({ ok: true });
}

// POST /api/discord/interactions — handle Discord slash commands
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get('x-signature-ed25519') || '';
  const timestamp = req.headers.get('x-signature-timestamp') || '';

  const valid = await verifyDiscordSignature(rawBody, signature, timestamp);
  if (!valid) {
    return new NextResponse('Invalid signature', { status: 401 });
  }

  const interaction = JSON.parse(rawBody);

  // Discord PING — required for endpoint verification
  if (interaction.type === INTERACTION_TYPE_PING) {
    return NextResponse.json({ type: 1 });
  }

  if (interaction.type === INTERACTION_TYPE_AUTOCOMPLETE && interaction.data?.name === 'map') {
    return handleMapAutocomplete(interaction);
  }

  if (interaction.type === INTERACTION_TYPE_AUTOCOMPLETE && interaction.data?.name === 'alt') {
    return handleAltAutocomplete(interaction);
  }

  if (interaction.type === INTERACTION_TYPE_COMMAND && interaction.data?.name === 'alt') {
    return handleAltCommand(interaction);
  }

  if (
    interaction.type === INTERACTION_TYPE_AUTOCOMPLETE &&
    (interaction.data?.name === 'leaderboard' || interaction.data?.name === 'lb')
  ) {
    return handleLeaderboardAutocomplete(interaction);
  }

  if (
    interaction.type === INTERACTION_TYPE_COMMAND &&
    (interaction.data?.name === 'leaderboard' || interaction.data?.name === 'lb')
  ) {
    return handleLeaderboardCommand(interaction);
  }

  if (interaction.type === INTERACTION_TYPE_COMMAND && interaction.data?.name === 'warn') {
    return handleWarnCommand(interaction);
  }

  if (interaction.type === INTERACTION_TYPE_COMMAND && interaction.data?.name === 'map') {
    return handleMapCommand(interaction);
  }

  if (interaction.type === INTERACTION_TYPE_COMMAND && interaction.data?.name === 'activity-bank') {
    return handleActivityBankCommand(interaction);
  }

  if (interaction.type === INTERACTION_TYPE_COMMAND && interaction.data?.name === 'whip') {
    return handleWhipCommand(interaction);
  }

  if (interaction.type === INTERACTION_TYPE_COMMAND && interaction.data?.name === 'bumps') {
    return handleBumpsCommand(interaction);
  }

  if (interaction.type === INTERACTION_TYPE_COMPONENT && interaction.data?.custom_id === 'bump_click') {
    return handleBumpClick(interaction);
  }

  return NextResponse.json({ type: 1 });
}

async function handleWarnCommand(interaction: {
  guild_id?: string;
  member?: { user?: { id: string; username: string }; roles?: string[] };
  data: { options?: Array<{ name: string; value: string | number }> };
}) {
  const supabase = createAdminClient();

  const REQUIRED_ROLE_ID = '1444749350285611038';
  const callerRoles = interaction.member?.roles ?? [];
  if (!callerRoles.includes(REQUIRED_ROLE_ID)) {
    return NextResponse.json({
      type: 4,
      data: {
        content: `You lack permission to use this command. Requires role <@&${REQUIRED_ROLE_ID}>.`,
        flags: 64,
      },
    });
  }

  const options = interaction.data?.options ?? [];
  const targetDiscordId = options.find((o) => o.name === 'user')?.value as string;
  const reason = (options.find((o) => o.name === 'reason')?.value as string) || null;
  const callerDiscordId = interaction.member?.user?.id;
  const callerUsername = interaction.member?.user?.username;

  if (!targetDiscordId) {
    return NextResponse.json({
      type: 4,
      data: { content: 'Missing user argument.', flags: 64 },
    });
  }

  // Look up member by discord_id
  const { data: member } = await supabase
    .from('members')
    .select('id, ign, current_guild_id, discord_id')
    .eq('discord_id', targetDiscordId)
    .eq('is_active', true)
    .maybeSingle();

  if (!member) {
    return NextResponse.json({
      type: 4,
      data: {
        content: `User <@${targetDiscordId}> is not mapped to a tracked member. Map their Discord ID in the admin panel first.`,
        flags: 64,
      },
    });
  }

  // Get guild name
  const { data: config } = await supabase
    .from('guild_config')
    .select('guild_name')
    .eq('guild_id', member.current_guild_id)
    .single();

  const guildName = config?.guild_name ?? member.current_guild_id;
  const reasonText = reason ? `\nReason: ${reason}` : '';
  const dmMsg = `⚠️ Warning\nYou have received a warning in **${guildName}** for inactivity.${reasonText}\nPlease ensure you meet the activity requirements to remain in the guild.`;

  let dmSent = false;
  let dmError: string | null = null;

  const dmResult = await sendDirectMessage(targetDiscordId, dmMsg);
  dmSent = dmResult.ok;
  dmError = dmResult.error ?? null;

  // Log warning
  await supabase.from('warnings').insert({
    member_id: member.id,
    guild_id: member.current_guild_id,
    warning_level: 'warn1',
    reason: reason,
    is_auto: false,
    discord_dm_sent: dmSent,
    discord_dm_error: dmError,
    warned_by_discord_id: callerDiscordId ?? null,
    warned_by_ign: callerUsername ?? null,
  });

  const dmStatus = dmSent ? '✅ DM sent' : `⚠️ DM failed: ${dmError}`;
  const responseMsg = `Warned **${member.ign}** in ${guildName}.${reason ? ` Reason: ${reason}` : ''}\n${dmStatus}`;

  return NextResponse.json({
    type: 4,
    data: { content: responseMsg, flags: 64 },
  });
}

async function handleMapAutocomplete(interaction: {
  data: { options?: Array<{ name: string; value: string; focused?: boolean }> };
}) {
  const supabase = createAdminClient();
  const focused = interaction.data?.options?.find((o) => o.focused);
  const query = focused?.value ?? '';

  const { data: members } = await supabase
    .from('members')
    .select('ign')
    .is('discord_id', null)
    .eq('is_active', true)
    .ilike('ign', `%${query}%`)
    .order('ign', { ascending: true })
    .limit(25);

  const choices = (members ?? []).map((m) => ({ name: m.ign, value: m.ign }));

  return NextResponse.json({ type: 8, data: { choices } });
}

async function handleActivityBankCommand(_interaction: unknown) {
  const supabase = createAdminClient();

  const { data: config } = await supabase
    .from('guild_config')
    .select('overflow_enabled, overflow_limit')
    .limit(1)
    .maybeSingle();

  const overflowEnabled = config?.overflow_enabled ?? false;
  const overflowLimit = config?.overflow_limit ?? 0;

  const statusLine = overflowEnabled
    ? `📊 **Status:** Enabled (cap: **${overflowLimit.toLocaleString()}** gold)`
    : `📊 **Status:** Disabled`;

  const msg = [
    '🏦 **Activity Bank**',
    '',
    'When you donate **more** than the daily gold requirement, the surplus is saved in your personal activity bank (up to the cap). On any future day where you fall short, the bank automatically covers the gap — so you still count as having met the requirement.',
    '',
    '**How it works:**',
    '• Surplus gold → deposited into your bank (up to the cap)',
    '• Shortfall → withdrawn from your bank automatically',
    '• If your bank runs dry and you miss the requirement, the day counts as inactive',
    '',
    statusLine,
  ].join('\n');

  return NextResponse.json({
    type: 4,
    data: { content: msg },
  });
}

const WHIP_GIF = 'https://tenor.com/view/fairy-tail-take-that-whip-lucy-heartfilia-anime-gif-16035520';

const WHIP_LINES = [
  'feels the crack of justice! ⚡',
  'has been disciplined! No mercy! 😤',
  'got absolutely roasted! 🔥',
  'is shaking in their boots right now! 💀',
  'didn\'t see that coming! *SNAP* 💥',
  'has been put in their place! 👑',
  'owes you an apology! 😈',
  'is learning a very important lesson today! 📚',
];

async function handleWhipCommand(interaction: {
  member?: { user?: { id: string; username: string } };
  data: { options?: Array<{ name: string; value: string }> };
}) {
  const options = interaction.data?.options ?? [];
  const targetId = options.find((o) => o.name === 'target')?.value as string;
  const callerId = interaction.member?.user?.id;

  if (!targetId) {
    return NextResponse.json({
      type: 4,
      data: { content: 'Who are you whipping?? Pick a target!', flags: 64 },
    });
  }

  const line = WHIP_LINES[Math.floor(Math.random() * WHIP_LINES.length)];
  const callerMention = callerId ? `<@${callerId}>` : 'Someone';

  const content = [
    `# 🔥 *C R A C K* 💥`,
    ``,
    `${callerMention} just whipped <@${targetId}> — and they ${line}`,
    ``,
    WHIP_GIF,
  ].join('\n');

  return NextResponse.json({
    type: 4,
    data: { content },
  });
}

async function handleMapCommand(interaction: {
  data: {
    options?: Array<{ name: string; value: string }>;
    resolved?: { users?: Record<string, { username: string; global_name?: string }> };
  };
}) {
  const supabase = createAdminClient();

  const options = interaction.data?.options ?? [];
  const targetDiscordId = options.find((o) => o.name === 'user')?.value as string;
  const ign = options.find((o) => o.name === 'ign')?.value as string;

  if (!targetDiscordId || !ign) {
    return NextResponse.json({
      type: 4,
      data: { content: 'Missing required arguments.', flags: 64 },
    });
  }

  const resolvedUser = interaction.data?.resolved?.users?.[targetDiscordId];
  const discordUsername = resolvedUser?.global_name ?? resolvedUser?.username ?? null;

  const { data: member } = await supabase
    .from('members')
    .select('id, ign, current_guild_id, discord_id')
    .ilike('ign', ign)
    .eq('is_active', true)
    .maybeSingle();

  if (!member) {
    return NextResponse.json({
      type: 4,
      data: { content: `No active member found with IGN **${ign}**.`, flags: 64 },
    });
  }

  // Update the member
  const { error } = await supabase
    .from('members')
    .update({ discord_id: targetDiscordId, discord_username: discordUsername })
    .eq('id', member.id);

  if (error) {
    return NextResponse.json({
      type: 4,
      data: { content: `DB error: ${error.message}`, flags: 64 },
    });
  }

  // Propagate to all alt-linked members (same logic as PATCH /api/members/list)
  const [{ data: fwdLinks }, { data: revLinks }] = await Promise.all([
    supabase.from('member_alts').select('alt_member_id').eq('member_id', member.id).not('alt_member_id', 'is', null),
    supabase.from('member_alts').select('member_id').eq('alt_member_id', member.id),
  ]);

  const linkedIds = new Set<string>([
    ...(fwdLinks ?? []).map((r) => r.alt_member_id).filter(Boolean) as string[],
    ...(revLinks ?? []).map((r) => r.member_id).filter(Boolean) as string[],
  ]);

  const parentIds = (revLinks ?? []).map((r) => r.member_id).filter(Boolean) as string[];
  if (parentIds.length > 0) {
    const { data: siblingLinks } = await supabase
      .from('member_alts')
      .select('alt_member_id')
      .in('member_id', parentIds)
      .not('alt_member_id', 'is', null);
    for (const r of siblingLinks ?? []) {
      if (r.alt_member_id && r.alt_member_id !== member.id) linkedIds.add(r.alt_member_id);
    }
  }

  const allLinkedIds = Array.from(linkedIds);
  if (allLinkedIds.length > 0) {
    await supabase
      .from('members')
      .update({ discord_id: targetDiscordId, discord_username: discordUsername })
      .in('id', allLinkedIds)
      .is('discord_id', null);
  }

  // Shared-discord-id → auto manual alt links between all members with this discord_id
  const { linkAltsBySharedDiscord } = await import('@/lib/discord-alt-link');
  const linkResult = await linkAltsBySharedDiscord(supabase, targetDiscordId);

  const altNote = allLinkedIds.length > 0 ? ` (+ ${allLinkedIds.length} alt${allLinkedIds.length > 1 ? 's' : ''})` : '';
  const autoLinkNote = linkResult.created > 0 ? ` 🔗 auto-linked ${linkResult.created} alt${linkResult.created > 1 ? 's' : ''} via shared Discord` : '';
  const overwriteNote = member.discord_id && member.discord_id !== targetDiscordId ? ' *(overwrote previous mapping)*' : '';
  const responseMsg = `✅ Mapped **${member.ign}** → <@${targetDiscordId}>${altNote}${overwriteNote}${autoLinkNote}`;

  return NextResponse.json({
    type: 4,
    data: { content: responseMsg, flags: 64 },
  });
}

async function handleLeaderboardAutocomplete(interaction: {
  data: { options?: Array<{ name: string; value: string; focused?: boolean }> };
}) {
  const supabase = createAdminClient();
  const focused = interaction.data?.options?.find((o) => o.focused);
  if (focused?.name !== 'guild') {
    return NextResponse.json({ type: 8, data: { choices: [] } });
  }
  const query = (focused?.value ?? '').toLowerCase();

  const { data: guilds } = await supabase
    .from('guilds')
    .select('id, name, nickname')
    .limit(100);

  const filtered = (guilds ?? []).filter((g) => {
    if (!query) return true;
    return (
      g.name?.toLowerCase().includes(query) ||
      g.nickname?.toLowerCase().includes(query)
    );
  });

  const choices = filtered.slice(0, 25).map((g) => ({
    name: `${g.nickname ?? ''} - ${g.name ?? ''}`.slice(0, 100),
    value: String(g.id),
  }));

  return NextResponse.json({ type: 8, data: { choices } });
}

async function handleLeaderboardCommand(interaction: {
  data: { options?: Array<{ name: string; value: string }> };
}) {
  const supabase = createAdminClient();
  const options = interaction.data?.options ?? [];

  const period = (options.find((o) => o.name === 'period')?.value as LeaderboardPeriod) || 'week';
  const filterRaw = (options.find((o) => o.name === 'filter')?.value as LeaderboardFilter) || 'all';
  const filter: LeaderboardFilter =
    filterRaw === 'locked' || filterRaw === 'non-locked' ? filterRaw : 'all';
  const guildFilter = (options.find((o) => o.name === 'guild')?.value as string) || null;

  try {
    const entries = await fetchLeaderboard({
      supabase,
      period,
      guildFilter,
      merged: false,
      filter,
    });

    let guildLabel: string | null = null;
    if (guildFilter) {
      const { data: g } = await supabase
        .from('guilds')
        .select('name, nickname')
        .eq('id', guildFilter)
        .maybeSingle();
      if (g) guildLabel = g.nickname ? `${g.nickname} - ${g.name}` : g.name;
    }

    const periodLabel = period === 'week' ? 'This Week' : period === 'month' ? 'This Month' : 'All Time';
    const filterLabel = filter === 'locked' ? 'Market-Locked' : filter === 'non-locked' ? 'Non-Locked' : null;
    const combinedLabel = [filterLabel, guildLabel].filter(Boolean).join(' · ') || null;
    const content = entries.length === 0
      ? `_No entries match those filters._${guildLabel ? `\n_Guild: ${guildLabel}_` : ''}`
      : formatLeaderboard(entries, periodLabel, combinedLabel);

    return NextResponse.json({
      type: 4,
      data: { content: content.slice(0, 2000) },
    });
  } catch (err) {
    return NextResponse.json({
      type: 4,
      data: { content: `Error: ${(err as Error).message}`, flags: 64 },
    });
  }
}

// ──────────────────────────── BUMP TRACKER ────────────────────────────

type BumpInteraction = {
  token: string;
  application_id: string;
  member?: {
    nick?: string | null;
    user?: { id: string; username: string; global_name?: string };
  };
  user?: { id: string; username: string; global_name?: string };
  data?: { options?: Array<{ name: string; value: string | number }>; custom_id?: string };
};

function getInteractionUser(i: BumpInteraction) {
  return i.member?.user ?? i.user;
}

function getDisplayName(i: BumpInteraction): string | null {
  const u = getInteractionUser(i);
  return i.member?.nick ?? u?.global_name ?? u?.username ?? null;
}

async function handleBumpClick(interaction: BumpInteraction) {
  const user = getInteractionUser(interaction);
  if (!user) {
    return NextResponse.json({
      type: 4,
      data: { content: 'Could not identify user.', flags: 64 },
    });
  }

  // Ack immediately with deferred ephemeral so Discord doesn't time out (3s).
  // All work happens after via waitUntil + followup webhook.
  waitUntil(processBump(interaction));

  return NextResponse.json({
    type: 5, // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE
    data: { flags: 64 },
  });
}

async function processBump(interaction: BumpInteraction) {
  const supabase = createAdminClient();
  const user = getInteractionUser(interaction);
  if (!user) return;
  const appId = interaction.application_id;
  const token = interaction.token;

  try {
    // GLOBAL cooldown — 1 bump per guild per hour.
    const last = await getLastBumpMs(supabase);
    const now = Date.now();
    if (last !== null) {
      const elapsed = now - last.ms;
      if (elapsed < COOLDOWN_MS) {
        const remaining = COOLDOWN_MS - elapsed;
        const who = last.discord_id === user.id ? 'You' : `<@${last.discord_id}>`;
        await editOriginalInteractionResponse(appId, token, {
          content: `⏰ ${who} already bumped. Guild can bump again in **${formatCooldown(remaining)}** (1h per guild, not per person).`,
          allowed_mentions: { parse: [] },
        });
        return;
      }
    }

    const { data: member } = await supabase
      .from('members')
      .select('id')
      .eq('discord_id', user.id)
      .eq('is_active', true)
      .maybeSingle();

    const displayUsername = getDisplayName(interaction) ?? user.username;

    await insertBump(supabase, {
      discord_id: user.id,
      discord_username: displayUsername,
      member_id: member?.id ?? null,
    });

    const [total, streak] = await Promise.all([
      countBumpsForUser(supabase, user.id),
      getUserStreak(supabase, user.id),
    ]);

    // Fulfill the deferred ephemeral with the real confirmation.
    const streakLine = streak > 1 ? ` • Streak: 🔥${streak}d` : '';
    await editOriginalInteractionResponse(appId, token, {
      content: `✅ Bump logged! Total: **${total}**${streakLine} • Guild can bump again in 1h`,
    });

    // Refresh the pinned bump message.
    const cfg = await readBumpConfig(supabase);
    if (cfg.bump_channel_id && cfg.bump_button_message_id) {
      const [recent, monthly, lastAfter] = await Promise.all([
        getRecentBumps(supabase, 3),
        getMonthlyLeaderboardWithStreaks(supabase, 3),
        getLastBumpMs(supabase),
      ]);
      const payload = buildBumpMessage({
        sourceUrl: cfg.bump_source_url || undefined,
        recent,
        monthly,
        lastBumpMs: lastAfter?.ms ?? null,
        cooldownMs: COOLDOWN_MS,
      });
      const editRes = await editChannelMessageRich(
        cfg.bump_channel_id,
        cfg.bump_button_message_id,
        payload as unknown as Record<string, unknown>
      );
      if (!editRes.ok) console.error('[bump] edit failed:', editRes.error);
    }

    // Public milestone / streak brags — only big ones, posted to brag channel.
    const BRAG_CHANNEL_ID = '1444751853500760146';
    const bigBumpMilestone = total > 0 && total % 100 === 0;
    const bigStreakMilestone = streak > 0 && streak % 30 === 0;
    if (bigBumpMilestone) {
      await postToChannel(
        BRAG_CHANNEL_ID,
        `🎉 <@${user.id}> just hit **${total}** bumps! 🚀`
      );
    }
    if (bigStreakMilestone) {
      const months = streak / 30;
      const label = months === 1 ? '1 month' : `${months} months`;
      await postToChannel(
        BRAG_CHANNEL_ID,
        `🔥 <@${user.id}> hit a **${label}** bump streak (${streak} days)!`
      );
    }
  } catch (err) {
    console.error('[bump] processBump error:', err);
    await editOriginalInteractionResponse(appId, token, {
      content: '⚠️ Something went wrong logging your bump. Try again in a moment.',
    }).catch(() => {});
  }
}

async function handleBumpsCommand(interaction: BumpInteraction) {
  const supabase = createAdminClient();

  const options = interaction.data?.options ?? [];
  const period = (options.find((o) => o.name === 'period')?.value as string) || 'all';
  const rawLimit = options.find((o) => o.name === 'limit')?.value as number | undefined;
  const limit = Math.min(Math.max(rawLimit ?? 10, 1), 25);

  let title: string;
  let lines: string[];

  if (period === 'streak') {
    const entries = await getStreakLeaderboard(supabase, limit);
    title = '🔥 **Bump Streak Leaderboard**';
    lines = entries.length === 0
      ? ['_No active streaks yet. Click the button to start!_']
      : entries.map((e, i) => `${medal(i)} **${displayName(e)}** — 🔥 ${e.streak}d`);
  } else if (period === 'month') {
    const entries = await getMonthlyLeaderboard(supabase, limit);
    const monthName = new Date().toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    title = `📊 **Bumps — ${monthName}**`;
    lines = entries.length === 0
      ? ['_No bumps this month yet._']
      : entries.map((e, i) => `${medal(i)} **${displayName(e)}** — ${e.count}`);
  } else {
    const entries = await getAllTimeLeaderboard(supabase, limit);
    title = '🏆 **Bump Leaderboard — All Time**';
    lines = entries.length === 0
      ? ['_No bumps yet. Be the first!_']
      : entries.map((e, i) => `${medal(i)} **${displayName(e)}** — ${e.count}`);
  }

  const content = [title, '', ...lines].join('\n').slice(0, 2000);

  return NextResponse.json({
    type: 4,
    data: { content, allowed_mentions: { parse: [] } },
  });
}


// --- /alt command: promote IGN to account main ---

const ALT_REQUIRED_ROLE_ID = '1444749350285611038';

async function handleAltAutocomplete(interaction: {
  data: { options?: Array<{ name: string; value: string; focused?: boolean }> };
}) {
  const supabase = createAdminClient();
  const focused = interaction.data?.options?.find((o) => o.focused);
  if (focused?.name !== 'ign') return NextResponse.json({ type: 8, data: { choices: [] } });
  const query = (focused.value ?? '').toLowerCase();
  const { data } = await supabase
    .from('members')
    .select('ign')
    .eq('is_active', true)
    .not('hashed_id', 'is', null)
    .limit(100);
  const filtered = (data ?? []).filter((m) => (query ? m.ign?.toLowerCase().includes(query) : true));
  const choices = filtered.slice(0, 25).map((m) => ({ name: m.ign, value: m.ign }));
  return NextResponse.json({ type: 8, data: { choices } });
}

async function handleAltCommand(interaction: {
  member?: { user?: { id: string; username: string }; roles?: string[] };
  data: { options?: Array<{ name: string; value: string }> };
}) {
  const roles = interaction.member?.roles ?? [];
  if (!roles.includes(ALT_REQUIRED_ROLE_ID)) {
    return NextResponse.json({
      type: 4,
      data: { content: `You lack permission. Requires <@&${ALT_REQUIRED_ROLE_ID}>.`, flags: 64 },
    });
  }

  const ign = interaction.data?.options?.find((o) => o.name === 'ign')?.value as string | undefined;
  if (!ign) return NextResponse.json({ type: 4, data: { content: 'Missing ign.', flags: 64 } });

  const supabase = createAdminClient();
  const { data: target } = await supabase
    .from('members')
    .select('id, ign, hashed_id')
    .ilike('ign', ign)
    .eq('is_active', true)
    .maybeSingle();
  if (!target) return NextResponse.json({ type: 4, data: { content: `No active member **${ign}**.`, flags: 64 } });
  if (!target.hashed_id) return NextResponse.json({ type: 4, data: { content: `${target.ign} missing hashed_id.`, flags: 64 } });

  const result = await switchAccountMain(supabase, target.id);
  if (result.account_size < 2) {
    return NextResponse.json({ type: 4, data: { content: `${target.ign} has no linked alts — nothing to switch.`, flags: 64 } });
  }
  return NextResponse.json({
    type: 4,
    data: { content: `👑 **${target.ign}** is now main (account: ${result.account_size} chars, ${result.rows_written} rows rewritten, locked as manual).`, flags: 64 },
  });
}
