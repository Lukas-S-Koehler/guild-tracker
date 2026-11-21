import { NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { createAdminClient } from '@/lib/supabase-server';
import {
  deleteChannelMessage,
  editChannelMessageRich,
  editOriginalInteractionResponse,
  pinChannelMessage,
  postToChannelRich,
} from '@/lib/discord-api';
import { GUIDE_SECTIONS, GUIDE_SITE_URL, sectionToDiscord, shortTitle } from '@/lib/game-guide';

// Published guide = one channel: [index, ...section messages]. IDs persisted so
// re-publishing edits messages in place (jump links stay valid).
const STATE_KEY = 'guide_discord_state';

interface GuideState {
  guild_id: string;
  channel_id: string;
  message_ids: string[]; // [0] = index
}

const msgLink = (g: string, c: string, m: string) => `https://discord.com/channels/${g}/${c}/${m}`;
const payload = (content: string) => ({ content, flags: 4 /* SUPPRESS_EMBEDS */, allowed_mentions: { parse: [] } });

async function readState(): Promise<GuideState | null> {
  const { data } = await createAdminClient().from('app_settings').select('value').eq('key', STATE_KEY).maybeSingle();
  if (!data?.value) return null;
  try {
    return JSON.parse(data.value) as GuideState;
  } catch {
    return null;
  }
}

async function writeState(state: GuideState) {
  await createAdminClient().from('app_settings').upsert({ key: STATE_KEY, value: JSON.stringify(state) });
}

function buildIndex(guildId: string, channelId: string, firstIds: string[]) {
  const lines = GUIDE_SECTIONS.map((s, i) => `${s.emoji} **[${shortTitle(s)}](${msgLink(guildId, channelId, firstIds[i])})**`);
  return [
    '# 📖 IdleMMO Guide',
    '-# Goals, typical paths and tips from the community. Tap a section to jump to it.',
    '',
    ...lines,
    '',
    `🌐 [Web version](<${GUIDE_SITE_URL}/guide>) · updated <t:${Math.floor(Date.now() / 1000)}:R>`,
  ].join('\n');
}

export async function publishGuide(guildId: string, channelId: string, fresh: boolean): Promise<string> {
  const prev = await readState();
  const reuse = !fresh && prev?.channel_id === channelId && prev.message_ids.length > 0;

  if (!reuse && fresh && prev) {
    for (const id of prev.message_ids) await deleteChannelMessage(prev.channel_id, id);
  }

  let indexId: string;
  let slots: string[];
  if (reuse) {
    [indexId, ...slots] = prev!.message_ids;
  } else {
    const r = await postToChannelRich(channelId, payload('📖 Publishing guide…'));
    if (!r.ok || !r.messageId) return `❌ Couldn't post here: ${r.error}`;
    indexId = r.messageId;
    slots = [];
  }

  const footer = `-# [⬆️ Back to index](${msgLink(guildId, channelId, indexId)})`;
  const firstIds: string[] = [];
  const used: string[] = [];
  let slot = 0;

  for (const section of GUIDE_SECTIONS) {
    const msgs = sectionToDiscord(section, GUIDE_SITE_URL, footer);
    for (let j = 0; j < msgs.length; j++) {
      let id: string;
      if (slot < slots.length) {
        id = slots[slot];
        const r = await editChannelMessageRich(channelId, id, payload(msgs[j]));
        if (!r.ok) return `❌ Couldn't edit an existing guide message (deleted?). Run \`/guide publish fresh:true\`.\n-# ${r.error}`;
      } else {
        const r = await postToChannelRich(channelId, payload(msgs[j]));
        if (!r.ok || !r.messageId) return `❌ Post failed at **${section.title}**: ${r.error}`;
        id = r.messageId;
      }
      if (j === 0) firstIds.push(id);
      used.push(id);
      slot++;
    }
  }

  // Guide got shorter → drop leftover slots.
  for (const id of slots.slice(slot)) await deleteChannelMessage(channelId, id);

  const idx = await editChannelMessageRich(channelId, indexId, payload(buildIndex(guildId, channelId, firstIds)));
  if (!idx.ok) return `❌ Couldn't update the index: ${idx.error}`;

  let pinNote = '';
  if (!reuse) {
    const pin = await pinChannelMessage(channelId, indexId);
    if (!pin.ok) pinNote = '\n⚠️ Couldn\'t pin the index (bot needs Pin Messages). Pin it manually.';
  }

  await writeState({ guild_id: guildId, channel_id: channelId, message_ids: [indexId, ...used] });

  const verb = reuse ? 'Updated' : 'Published';
  return `✅ ${verb} guide: ${GUIDE_SECTIONS.length} sections, ${used.length} messages. [Index](${msgLink(guildId, channelId, indexId)})${pinNote}`;
}

interface GuideInteraction {
  application_id: string;
  token: string;
  guild_id?: string;
  channel_id?: string;
  member?: { roles?: string[] };
  data?: { options?: Array<{ name: string; options?: Array<{ name: string; value: unknown }> }> };
}

export async function handleGuideCommand(i: GuideInteraction, staffRoleId: string) {
  const sub = i.data?.options?.[0];

  if (sub?.name === 'publish') {
    if (!i.member?.roles?.includes(staffRoleId)) {
      return NextResponse.json({ type: 4, data: { content: `You lack permission. Requires <@&${staffRoleId}>.`, flags: 64 } });
    }
    if (!i.guild_id || !i.channel_id) {
      return NextResponse.json({ type: 4, data: { content: 'Run this inside a server channel.', flags: 64 } });
    }
    const fresh = sub.options?.find((o) => o.name === 'fresh')?.value === true;
    const { guild_id, channel_id } = i;
    waitUntil(
      (async () => {
        let content: string;
        try {
          content = await publishGuide(guild_id, channel_id, fresh);
        } catch (err) {
          content = `❌ ${String(err)}`;
        }
        await editOriginalInteractionResponse(i.application_id, i.token, { content });
      })()
    );
    return NextResponse.json({ type: 5, data: { flags: 64 } });
  }

  // show
  const state = await readState();
  const lines = [`🌐 [Web guide](<${GUIDE_SITE_URL}/guide>)`];
  if (state) lines.unshift(`📖 [Guide index](${msgLink(state.guild_id, state.channel_id, state.message_ids[0])})`);
  return NextResponse.json({ type: 4, data: { content: lines.join('\n'), flags: 64 } });
}
