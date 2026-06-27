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
