/**
 * RSVP buttons on pre-launch assault notices (docs/assault-roster.md §7).
 * custom_id: rsvp:<guildId>:<waveUnix>:<in|maybe|out>
 * The clicker's characters in that guild are found via members.discord_id and the site
 * account link (user_discord_links → claimed account bundle). Every default answers: a
 * not-assaulting character saying "in" is counted for that wave only.
 */
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { getAccountCharacters } from '@/lib/account-service';
import { RSVP_LABEL, RSVP_STATUSES, rsvpComponents, setRsvp, type RsvpStatus } from '@/lib/assault-rsvp';
import { refreshRosterBoardSoon } from '@/lib/roster-discord';

const LABEL = RSVP_LABEL;
export { rsvpComponents };

const ephemeral = (content: string) => NextResponse.json({ type: 4, data: { content, flags: 64 } });

export async function handleRsvpComponent(interaction: {
  data: { custom_id: string };
  member?: { user?: { id: string } };
  user?: { id: string };
}) {
  const m = interaction.data.custom_id.match(/^rsvp:([^:]+):(\d+):(in|maybe|out)$/);
  const discordId = interaction.member?.user?.id ?? interaction.user?.id;
  if (!m || !discordId) return ephemeral('Unknown RSVP button.');
  const [, guildId, waveStr, status] = m;
  const waveUnix = Number(waveStr);
  if (!RSVP_STATUSES.includes(status as RsvpStatus)) return ephemeral('Unknown answer.');
  if (waveUnix * 1000 < Date.now()) return ephemeral('That wave already started. Answers are for upcoming waves.');

  const supabase = createAdminClient();
  const ids = new Set<string>();
  const { data: direct } = await supabase
    .from('members')
    .select('id')
    .eq('discord_id', discordId)
    .eq('current_guild_id', guildId)
    .eq('is_active', true);
  for (const r of direct ?? []) ids.add(r.id as string);
  const { data: link } = await supabase.from('user_discord_links').select('user_id').eq('discord_id', discordId).maybeSingle();
  if (link?.user_id) {
    for (const c of await getAccountCharacters(link.user_id as string, supabase)) {
      if (c.in_dream_guild && c.guild_id === guildId) ids.add(c.member_id);
    }
  }
  if (!ids.size) {
    return ephemeral("I couldn't find your character in this guild. Link your Discord on the site (claim your character) or ask staff to map you.");
  }
  const { data: roster } = await supabase
    .from('assault_roster')
    .select('member_id, ign, participation')
    .in('member_id', Array.from(ids));
  const eligible = roster ?? [];
  if (!eligible.length) return ephemeral("Your characters here aren't on the assault roster yet. It syncs daily; ask staff to refresh it.");

  await setRsvp({ guildId, waveUnix, memberIds: eligible.map((r) => r.member_id as string), status: status as RsvpStatus, source: 'discord', discordId }, supabase);
  refreshRosterBoardSoon(guildId);
  const names = eligible.map((r) => r.ign).join(', ');
  const oneOff = status !== 'out' ? eligible.filter((r) => r.participation === 'none').map((r) => r.ign) : [];
  return ephemeral(
    `${status === 'in' ? '✅' : status === 'maybe' ? '🤔' : '❌'} **${LABEL[status as RsvpStatus]}** for the wave <t:${waveUnix}:R> · ${names}. Change it any time with the buttons or on the assault roster.` +
      (oneOff.length ? `\n-# ${oneOff.join(', ')} ${oneOff.length > 1 ? 'are' : 'is'} set to not assaulting by default, so this counts for this wave only. Change the default on the roster.` : '')
  );
}
