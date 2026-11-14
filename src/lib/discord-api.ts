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

/** Edit an existing message in a channel with arbitrary payload (content + components, etc). */
export async function editChannelMessageRich(
  channelId: string,
  messageId: string,
  payload: Record<string, unknown>
): Promise<{ ok: boolean; error?: string }> {
  try {
    await discordFetch(`/channels/${channelId}/messages/${messageId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** Post arbitrary payload to a channel. */
export async function postToChannelRich(
  channelId: string,
  payload: Record<string, unknown>
): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  try {
    const msg = await discordFetch<{ id: string }>(`/channels/${channelId}/messages`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return { ok: true, messageId: msg.id };
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
    {
      name: 'merge_alts',
      type: 5,
      description: 'Merge alt characters into one entry (same as website toggle)',
      required: false,
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

/** Edit the original (deferred) interaction response. */
export async function editOriginalInteractionResponse(
  applicationId: string,
  interactionToken: string,
  payload: { content?: string; flags?: number; allowed_mentions?: unknown }
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(
      `${DISCORD_API}/webhooks/${applicationId}/${interactionToken}/messages/@original`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    );
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `Edit original ${res.status}: ${text}` };
    }
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
/** List all global application commands. */
export async function listGlobalCommands(): Promise<{ ok: boolean; commands?: Array<{ id: string; name: string; description?: string; options?: unknown }>; error?: string }> {
  const appId = process.env.DISCORD_APPLICATION_ID;
  if (!appId) return { ok: false, error: 'DISCORD_APPLICATION_ID not set' };
  try {
    const commands = await discordFetch<Array<{ id: string; name: string; description?: string; options?: unknown }>>(`/applications/${appId}/commands`);
    return { ok: true, commands };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** List commands scoped to a specific guild. */
export async function listGuildCommands(guildId: string): Promise<{ ok: boolean; commands?: Array<{ id: string; name: string; description?: string; options?: unknown }>; error?: string }> {
  const appId = process.env.DISCORD_APPLICATION_ID;
  if (!appId) return { ok: false, error: 'DISCORD_APPLICATION_ID not set' };
  try {
    const commands = await discordFetch<Array<{ id: string; name: string; description?: string; options?: unknown }>>(`/applications/${appId}/guilds/${guildId}/commands`);
    return { ok: true, commands };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** Delete a global application command by id. */
export async function deleteGlobalCommand(commandId: string): Promise<{ ok: boolean; error?: string }> {
  const appId = process.env.DISCORD_APPLICATION_ID;
  if (!appId) return { ok: false, error: 'DISCORD_APPLICATION_ID not set' };
  try {
    await discordFetch(`/applications/${appId}/commands/${commandId}`, { method: 'DELETE' });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** Delete a guild-scoped application command by id. */
export async function deleteGuildCommand(guildId: string, commandId: string): Promise<{ ok: boolean; error?: string }> {
  const appId = process.env.DISCORD_APPLICATION_ID;
  if (!appId) return { ok: false, error: 'DISCORD_APPLICATION_ID not set' };
  try {
    await discordFetch(`/applications/${appId}/guilds/${guildId}/commands/${commandId}`, { method: 'DELETE' });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** Register the /make-main command — promote an IGN to main of its account. */
export async function registerAltCommand(): Promise<{ ok: boolean; error?: string }> {
  const appId = process.env.DISCORD_APPLICATION_ID;
  if (!appId) return { ok: false, error: 'DISCORD_APPLICATION_ID not set' };

  const command = {
    name: 'make-main',
    description: 'Set a character as the main of its alt account',
    options: [
      {
        name: 'ign',
        type: 3,
        description: 'IGN to make main',
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

/** Register the /assault slash command with all subcommands. */
export async function registerAssaultCommand(): Promise<{ ok: boolean; error?: string }> {
  const appId = process.env.DISCORD_APPLICATION_ID;
  if (!appId) return { ok: false, error: 'DISCORD_APPLICATION_ID not set' };

  const guildOpt = {
    name: 'guild',
    type: 3, // STRING
    description: 'Which assaulting guild',
    required: true,
    autocomplete: true,
  };
  const stepOpt = {
    name: 'step',
    type: 3,
    description: 'Ping step key (e.g. launch_0)',
    required: true,
    autocomplete: true,
  };

  const command = {
    name: 'assault',
    description: 'Manage the daily guild assault schedule',
    options: [
      { name: 'status', type: 1, description: 'Show active state + countdowns for both guilds' },
      {
        name: 'toggle',
        type: 1,
        description: 'Enable or pause the daily schedule for a guild',
        options: [
          guildOpt,
          {
            name: 'state',
            type: 3,
            description: 'active or paused',
            required: true,
            choices: [
              { name: 'active', value: 'active' },
              { name: 'paused', value: 'paused' },
            ],
          },
        ],
      },
      {
        name: 'set-time',
        type: 1,
        description: 'Set daily launch time (UTC HH:MM)',
        options: [
          guildOpt,
          { name: 'time', type: 3, description: 'UTC HH:MM e.g. 18:30', required: true },
        ],
      },
      {
        name: 'set-zone',
        type: 1,
        description: 'Quickly update zone / shrine / kill order',
        options: [
          guildOpt,
          { name: 'zone', type: 3, description: 'Zone name', required: false },
          { name: 'shrine', type: 3, description: 'Shrine info / location', required: false },
          { name: 'mob_order', type: 3, description: 'Kill order string (overrides enemy_priority formatting)', required: false },
        ],
      },
      {
        name: 'ping-now',
        type: 1,
        description: 'Fire a specific step immediately',
        options: [guildOpt, stepOpt],
      },
      {
        name: 'skip-today',
        type: 1,
        description: "Skip today's scheduled pings (tomorrow unaffected)",
        options: [guildOpt],
      },
      {
        name: 'lb',
        type: 1,
        description: 'Show top contributors leaderboard',
        options: [
          { ...guildOpt, required: false },
          { name: 'season', type: 4, description: 'Season number (optional)', required: false },
        ],
      },
      {
        name: 'last',
        type: 1,
        description: 'Show last finalized assault summary for a guild',
        options: [guildOpt],
      },
      {
        name: 'checklist',
        type: 1,
        description: 'Personal prep checklist (guild inferred from your roles; timings from your loadout)',
      },
      {
        name: 'plan',
        type: 1,
        description: 'Show kill priority + gold/hr for a zone',
        options: [
          guildOpt,
          {
            name: 'zone',
            type: 3,
            description: 'Override zone (autocomplete). Defaults to guild config.',
            required: false,
            autocomplete: true,
          },
        ],
      },
      {
        name: 'conquest',
        type: 1,
        description: 'Show conquest mechanics: EXP split, waves, territory boosts, shard rewards',
      },
      {
        name: 'potions',
        type: 1,
        description: 'Pick + save your potion loadout (preset → tweak → save)',
      },
      {
        name: 'loadout',
        type: 1,
        description: 'Show your saved potion loadout',
        options: [
          {
            name: 'name',
            type: 3,
            description: 'Loadout name (defaults to your default)',
            required: false,
            autocomplete: true,
          },
        ],
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
