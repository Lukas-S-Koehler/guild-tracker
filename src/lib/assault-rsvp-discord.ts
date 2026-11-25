/**
 * RSVP buttons on pre-launch assault notices (docs/assault-roster.md §7).
 * custom_id: rsvp:<guildId>:<waveUnix>:<in|maybe|out>
 * The clicker's characters in that guild are found via members.discord_id and the site
 * account link (user_discord_links → claimed account bundle); not-assaulting ones are skipped.
 */
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { getAccountCharacters } from '@/lib/account-service';
import { RSVP_STATUSES, setRsvp, type RsvpStatus } from '@/lib/assault-rsvp';

const LABEL: Record<RsvpStatus, string> = { in: "I'm in", maybe: 'Maybe', out: "Can't make it" };

export function rsvpComponents(guildId: string, waveUnix: number) {
  return [
    {
      type: 1,
      components: [
        { type: 2, style: 3, label: LABEL.in, custom_id: `rsvp:${guildId}:${waveUnix}:in` },
        { type: 2, style: 2, label: LABEL.maybe, custom_id: `rsvp:${guildId}:${waveUnix}:maybe` },
        { type: 2, style: 4, label: LABEL.out, custom_id: `rsvp:${guildId}:${waveUnix}:out` },
      ],
    },
  ];
}

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
  const eligible = (roster ?? []).filter((r) => r.participation !== 'none');
  if (!eligible.length) return ephemeral('Your characters here are marked as not assaulting. Ask staff if that changed.');

  await setRsvp({ guildId, waveUnix, memberIds: eligible.map((r) => r.member_id as string), status: status as RsvpStatus, source: 'discord', discordId }, supabase);
  const names = eligible.map((r) => r.ign).join(', ');
  return ephemeral(`${status === 'in' ? '✅' : status === 'maybe' ? '🤔' : '❌'} **${LABEL[status as RsvpStatus]}** for the wave <t:${waveUnix}:R> · ${names}. Change it any time with the buttons or on the assault roster.`);
}
