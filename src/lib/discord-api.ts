const DISCORD_API = 'https://discord.com/api/v10';

function getBotToken(): string {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) throw new Error('DISCORD_BOT_TOKEN not configured');
  return token;
}

async function discordFetch<T>(
  path: string,
  options?: RequestInit,
  _retried = false
): Promise<T> {
  const res = await fetch(`${DISCORD_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bot ${getBotToken()}`,
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    },
  });
  if (res.status === 429 && !_retried) {
    const data = await res.json().catch(() => ({ retry_after: 1 }));
    await new Promise(r => setTimeout(r, (data.retry_after ?? 1) * 1000));
    return discordFetch(path, options, true);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Discord API ${res.status}: ${text}`);
  }
  return res.json();
}

/** Open (or fetch existing) DM channel with a Discord user. */
async function getDmChannelId(discordUserId: string): Promise<string> {
  const data = await discordFetch<{ id: string }>('/users/@me/channels', {
    method: 'POST',
    body: JSON.stringify({ recipient_id: discordUserId }),
  });
  return data.id;
}

/** Send a DM to a Discord user. Returns true on success. */
export async function sendDirectMessage(
  discordUserId: string,
  content: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const channelId = await getDmChannelId(discordUserId);
    await discordFetch(`/channels/${channelId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** Post a message to a channel (for warn summaries). */
export async function postToChannel(
  channelId: string,
  content: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    await discordFetch(`/channels/${channelId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** Post a message to a channel and return the new message ID. */
export async function postToChannelReturnId(
  channelId: string,
  content: string
): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  try {
    const msg = await discordFetch<{ id: string }>(`/channels/${channelId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
    return { ok: true, messageId: msg.id };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** Edit an existing message in a channel. */
export async function editChannelMessage(
  channelId: string,
  messageId: string,
  content: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    await discordFetch(`/channels/${channelId}/messages/${messageId}`, {
      method: 'PATCH',
      body: JSON.stringify({ content }),
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** Verify Discord Interactions request signature (ed25519). */
export async function verifyDiscordSignature(
  rawBody: string,
  signature: string,
  timestamp: string
): Promise<boolean> {
  const publicKey = process.env.DISCORD_PUBLIC_KEY;
  if (!publicKey) return false;

  try {
    const encoder = new TextEncoder();
    const keyData = hexToBytes(publicKey);
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'Ed25519', namedCurve: 'Ed25519' },
      false,
      ['verify']
    );
    const message = encoder.encode(timestamp + rawBody);
    const sig = hexToBytes(signature);
    return await crypto.subtle.verify('Ed25519', cryptoKey, sig, message);
  } catch {
    return false;
  }
}

function hexToBytes(hex: string): ArrayBuffer {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    arr[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return arr.buffer as ArrayBuffer;
}

/** Register the /warn slash command on the Discord application. Call once via admin. */
export async function registerWarnCommand(): Promise<{ ok: boolean; error?: string }> {
  const appId = process.env.DISCORD_APPLICATION_ID;
  if (!appId) return { ok: false, error: 'DISCORD_APPLICATION_ID not set' };

  const command = {
    name: 'warn',
    description: 'Warn a guild member for inactivity',
    options: [
      {
        name: 'user',
        type: 6, // USER type
        description: 'Discord user to warn',
        required: true,
      },
      {
        name: 'reason',
        type: 3, // STRING type
        description: 'Reason for warning',
        required: false,
      },
    ],
  };

  try {
    await discordFetch(`/applications/${appId}/commands`, {
      method: 'POST',
      body: JSON.stringify(command),
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** Register the /activity-bank slash command on the Discord application. Call once via admin. */
export async function registerActivityBankCommand(): Promise<{ ok: boolean; error?: string }> {
  const appId = process.env.DISCORD_APPLICATION_ID;
  if (!appId) return { ok: false, error: 'DISCORD_APPLICATION_ID not set' };

  const command = {
    name: 'activity-bank',
    description: 'Explains how the activity bank (overflow bank) works',
  };

  try {
    await discordFetch(`/applications/${appId}/commands`, {
      method: 'POST',
      body: JSON.stringify(command),
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** Register the /whip slash command on the Discord application. Call once via admin. */
export async function registerWhipCommand(): Promise<{ ok: boolean; error?: string }> {
  const appId = process.env.DISCORD_APPLICATION_ID;
  if (!appId) return { ok: false, error: 'DISCORD_APPLICATION_ID not set' };

  const command = {
    name: 'whip',
    description: '🔥 Whip a guild member into shape',
    options: [
      {
        name: 'target',
        type: 6, // USER type
        description: 'The poor soul getting whipped',
        required: true,
      },
    ],
  };

  try {
    await discordFetch(`/applications/${appId}/commands`, {
      method: 'POST',
      body: JSON.stringify(command),
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** Register the /leaderboard and /lb slash commands. Call once via admin. */
export async function registerLeaderboardCommand(): Promise<{ ok: boolean; error?: string }> {
  const appId = process.env.DISCORD_APPLICATION_ID;
  if (!appId) return { ok: false, error: 'DISCORD_APPLICATION_ID not set' };

  const options = [
    {
      name: 'period',
      type: 3,
      description: 'Time period',
      required: false,
      choices: [
        { name: 'Week', value: 'week' },
        { name: 'Month', value: 'month' },
        { name: 'All Time', value: 'all' },
      ],
    },
    {
      name: 'filter',
      type: 3,
      description: 'Market-lock filter',
      required: false,
      choices: [
        { name: 'All', value: 'all' },
        { name: 'Non-Locked', value: 'non-locked' },
        { name: 'Market-Locked', value: 'locked' },
      ],
    },
    {
      name: 'guild',
      type: 3,
      description: 'Guild filter',
      required: false,
      autocomplete: true,
    },
  ];

  try {
    for (const name of ['leaderboard', 'lb']) {
      await discordFetch(`/applications/${appId}/commands`, {
        method: 'POST',
        body: JSON.stringify({
          name,
          description: 'Show the activity leaderboard',
          options,
        }),
      });
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** Post persistent "I Bumped!" button message in channel. Returns new message id. */
export async function postBumpButton(
  channelId: string,
  sourceUrl?: string
): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  try {
    const buttons: Array<Record<string, unknown>> = [];
    if (sourceUrl) {
      buttons.push({
        type: 2,
        style: 5, // LINK
        label: '🔗 Go Bump!',
        url: sourceUrl,
      });
    }
    buttons.push({
      type: 2,
      style: 1,
      label: '🚀 I Bumped!',
      custom_id: 'bump_click',
    });
    buttons.push({
      type: 2,
      style: 2,
      label: '📊 Leaderboard',
      custom_id: 'bump_leaderboard',
    });

    const steps = sourceUrl
      ? [
          '**How it works:**',
          '1. Click 🔗 **Go Bump!** → opens main IdleMMO bump channel',
          '2. Post "bump" there, delete your message',
          '3. Come back and click 🚀 **I Bumped!** to log it',
        ].join('\n')
      : 'Bumped our guild ad in the main IdleMMO Discord? Click 🚀 **I Bumped!** below to log it.';

    const payload = {
      content: [
        '# 🚀 Guild Bumping',
        '',
        steps,
        '',
        '**Rules:**',
        '• Max 1 bump per 2 hours (same as main server)',
        '• Top bumper each month earns 👑 **Bump King** role',
        '• Streaks, milestones, bragging rights 🔥',
        '',
        'Run `/bumps` to see the leaderboard.',
      ].join('\n'),
      components: [{ type: 1, components: buttons }],
    };
    const msg = await discordFetch<{ id: string }>(`/channels/${channelId}/messages`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return { ok: true, messageId: msg.id };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** Add role to a guild member. */
export async function addGuildMemberRole(
  guildId: string,
  userId: string,
  roleId: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    await discordFetch(`/guilds/${guildId}/members/${userId}/roles/${roleId}`, {
      method: 'PUT',
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** Remove role from a guild member. */
export async function removeGuildMemberRole(
  guildId: string,
  userId: string,
  roleId: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    await discordFetch(`/guilds/${guildId}/members/${userId}/roles/${roleId}`, {
      method: 'DELETE',
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** Send a follow-up message to an interaction (uses webhook token, no bot auth needed). */
export async function sendInteractionFollowup(
  applicationId: string,
  interactionToken: string,
  payload: { content?: string; flags?: number; allowed_mentions?: unknown }
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(
      `${DISCORD_API}/webhooks/${applicationId}/${interactionToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    );
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `Followup ${res.status}: ${text}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** Register the /bumps slash command. Call once via admin. */
export async function registerBumpsCommand(): Promise<{ ok: boolean; error?: string }> {
  const appId = process.env.DISCORD_APPLICATION_ID;
  if (!appId) return { ok: false, error: 'DISCORD_APPLICATION_ID not set' };

  const command = {
    name: 'bumps',
    description: 'Show the bump leaderboard',
    options: [
      {
        name: 'period',
        type: 3,
        description: 'Leaderboard period',
        required: false,
        choices: [
          { name: 'All Time', value: 'all' },
          { name: 'This Month', value: 'month' },
          { name: 'Streaks', value: 'streak' },
        ],
      },
      {
        name: 'limit',
        type: 4, // INTEGER
        description: 'Entries to show (default 10, max 25)',
        required: false,
      },
    ],
  };

  try {
    await discordFetch(`/applications/${appId}/commands`, {
      method: 'POST',
      body: JSON.stringify(command),
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** Register the /map slash command on the Discord application. Call once via admin. */
export async function registerMapCommand(): Promise<{ ok: boolean; error?: string }> {
  const appId = process.env.DISCORD_APPLICATION_ID;
  if (!appId) return { ok: false, error: 'DISCORD_APPLICATION_ID not set' };

  const command = {
    name: 'map',
    description: 'Link a Discord user to a guild member',
    options: [
      {
        name: 'user',
        type: 6, // USER type
        description: 'Discord user to link',
        required: true,
      },
      {
        name: 'ign',
        type: 3, // STRING type
        description: 'In-game name of the member to link to',
        required: true,
        autocomplete: true,
      },
    ],
  };

  try {
    await discordFetch(`/applications/${appId}/commands`, {
      method: 'POST',
      body: JSON.stringify(command),
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
