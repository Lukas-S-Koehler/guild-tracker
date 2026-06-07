import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { verifyDiscordSignature, sendDirectMessage, registerWarnCommand, registerMapCommand } from '@/lib/discord-api';

const INTERACTION_TYPE_PING = 1;
const INTERACTION_TYPE_COMMAND = 2;
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

  if (interaction.type === INTERACTION_TYPE_COMMAND && interaction.data?.name === 'warn') {
    return handleWarnCommand(interaction);
  }

  if (interaction.type === INTERACTION_TYPE_COMMAND && interaction.data?.name === 'map') {
    return handleMapCommand(interaction);
  }

  return NextResponse.json({ type: 1 });
}

async function handleWarnCommand(interaction: {
  guild_id?: string;
  member?: { user?: { id: string; username: string }; roles?: string[] };
  data: { options?: Array<{ name: string; value: string | number }> };
}) {
  const supabase = createAdminClient();

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

  const altNote = allLinkedIds.length > 0 ? ` (+ ${allLinkedIds.length} alt${allLinkedIds.length > 1 ? 's' : ''})` : '';
  const overwriteNote = member.discord_id && member.discord_id !== targetDiscordId ? ' *(overwrote previous mapping)*' : '';
  const responseMsg = `✅ Mapped **${member.ign}** → <@${targetDiscordId}>${altNote}${overwriteNote}`;

  return NextResponse.json({
    type: 4,
    data: { content: responseMsg, flags: 64 },
  });
}
