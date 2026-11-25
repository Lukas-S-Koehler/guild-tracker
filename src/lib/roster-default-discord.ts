/**
 * Assault participation default from Discord (docs/assault-roster.md §7c):
 * `/roster-default default:<auto|opt_in|none> [ign]` and the buttons on your own `/roster` card.
 * Only the character's own player (members.discord_id or the site account linked to this Discord).
 * Per-wave answers stay on the RSVP buttons; this is the default they fall back to.
 */
import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase-server';
import { getAccountCharacters } from '@/lib/account-service';
import { PARTICIPATION, type Participation } from '@/lib/assault-roster';
import { refreshRosterBoardSoon } from '@/lib/roster-discord';

export const DEFAULT_LABEL: Record<Participation, string> = { auto: 'Auto', opt_in: 'Opt-in', none: 'Not assaulting' };
const DEFAULT_HINT: Record<Participation, string> = {
  auto: 'counted in for every wave unless you say out',
  opt_in: 'counted only for waves you say in to',
  none: 'out unless you say in for a wave',
};
const EMOJI: Record<Participation, string> = { auto: '✅', opt_in: '🙋', none: '💤' };

const ephemeral = (content: string, components?: unknown[]) =>
  NextResponse.json({ type: 4, data: { content, flags: 64, allowed_mentions: { parse: [] }, ...(components ? { components } : {}) } });

export interface MyRosterChar { member_id: string; ign: string; guild_id: string; participation: Participation }

/** Roster characters that belong to this Discord user, plus the linked site account (if any). */
export async function discordRosterCharacters(
  discordId: string,
  supabase: SupabaseClient = createAdminClient()
): Promise<{ chars: MyRosterChar[]; userId: string | null }> {
  const ids = new Set<string>();
  const { data: direct } = await supabase.from('members').select('id').eq('discord_id', discordId).eq('is_active', true);
  for (const r of direct ?? []) ids.add(r.id as string);
  const { data: link } = await supabase.from('user_discord_links').select('user_id').eq('discord_id', discordId).maybeSingle();
  const userId = (link?.user_id as string | undefined) ?? null;
  if (userId) for (const c of await getAccountCharacters(userId, supabase)) ids.add(c.member_id);
  if (!ids.size) return { chars: [], userId };
  const { data } = await supabase.from('assault_roster').select('member_id, ign, guild_id, participation').in('member_id', Array.from(ids)).order('ign');
  return {
    chars: (data ?? []).map((r) => ({
      member_id: r.member_id as string,
      ign: r.ign as string,
      guild_id: String(r.guild_id),
      participation: (PARTICIPATION.includes(r.participation) ? r.participation : 'auto') as Participation,
    })),
    userId,
  };
}

async function applyDefault(supabase: SupabaseClient, chars: MyRosterChar[], value: Participation, userId: string | null) {
  const { error } = await supabase
    .from('assault_roster')
    .update({ participation: value, participation_by: userId })
    .in('member_id', chars.map((c) => c.member_id));
  if (error) throw new Error(error.message);
  for (const g of Array.from(new Set(chars.map((c) => c.guild_id)))) refreshRosterBoardSoon(g);
}

const doneText = (chars: MyRosterChar[], value: Participation) =>
  `${EMOJI[value]} Default set to **${DEFAULT_LABEL[value]}** for ${chars.map((c) => c.ign).join(', ')}: ${DEFAULT_HINT[value]}.\n` +
  '-# Single waves: use the RSVP buttons on the pinned roster board. Change this any time with `/roster-default`.';

/** The three default buttons for one character (shown on your own /roster card). */
export function defaultButtons(memberId: string, current: Participation, ign?: string) {
  return {
    type: 1,
    components: (['auto', 'opt_in', 'none'] as Participation[]).map((v) => ({
      type: 2,
      style: v === current ? 1 : 2,
      label: `${ign ? `${ign}: ` : ''}${DEFAULT_LABEL[v]}${v === current ? ' (now)' : ''}`.slice(0, 80),
      custom_id: `rdef:${memberId}:${v}`,
      disabled: v === current,
    })),
  };
}

interface Interaction {
  member?: { user?: { id: string } };
  user?: { id: string };
  data: { custom_id?: string; options?: { name: string; value: string | number; focused?: boolean }[] };
}
const discordOf = (i: Interaction) => i.member?.user?.id ?? i.user?.id ?? '';

/** /roster-default default:<auto|opt_in|none> [ign] — no ign = all your characters on a roster. */
export async function handleRosterDefaultCommand(i: Interaction) {
  const opt = (n: string) => i.data.options?.find((o) => o.name === n)?.value;
  const value = String(opt('default') ?? '') as Participation;
  const ign = typeof opt('ign') === 'string' ? (opt('ign') as string).trim() : '';
  if (!PARTICIPATION.includes(value)) return ephemeral('Pick Auto, Opt-in or Not assaulting.');
  const discordId = discordOf(i);
  const supabase = createAdminClient();
  const { chars, userId } = await discordRosterCharacters(discordId, supabase);
  if (!chars.length) {
    return ephemeral("I couldn't find a character of yours on the DE / DI roster. Claim your character on the site (with Discord linked) or ask staff to map you.");
  }
  const targets = ign ? chars.filter((c) => c.ign.toLowerCase() === ign.toLowerCase()) : chars;
  if (!targets.length) return ephemeral(`${ign} isn't one of your roster characters (${chars.map((c) => c.ign).join(', ')}).`);
  await applyDefault(supabase, targets, value, userId);
  return ephemeral(doneText(targets, value));
}

/** Autocomplete for /roster-default ign: only your own roster characters. */
export async function handleRosterDefaultAutocomplete(i: Interaction) {
  const q = String(i.data.options?.find((o) => o.focused)?.value ?? '').trim().toLowerCase();
  const { chars } = await discordRosterCharacters(discordOf(i));
  return NextResponse.json({
    type: 8,
    data: {
      choices: chars
        .filter((c) => !q || c.ign.toLowerCase().includes(q))
        .slice(0, 25)
        .map((c) => ({ name: `${c.ign} (now ${DEFAULT_LABEL[c.participation]})`, value: c.ign })),
    },
  });
}

/** Buttons rdef:<memberId>:<value> on your own /roster card. */
export async function handleRosterDefaultComponent(i: Interaction) {
  const m = (i.data.custom_id ?? '').match(/^rdef:([0-9a-f-]+):(auto|opt_in|none)$/);
  if (!m) return ephemeral('Unknown button.');
  const [, memberId, value] = m;
  const supabase = createAdminClient();
  const { chars, userId } = await discordRosterCharacters(discordOf(i), supabase);
  const target = chars.find((c) => c.member_id === memberId);
  if (!target) return ephemeral('Only the player of this character can change their default.');
  await applyDefault(supabase, [target], value as Participation, userId);
  return ephemeral(doneText([target], value as Participation));
}

export const ROSTER_DEFAULT_COMMAND = {
  name: 'roster-default',
  description: 'Your assault default: Auto, Opt-in or Not assaulting (single waves: RSVP buttons)',
  options: [
    {
      name: 'default', type: 3, description: 'How you are counted by default', required: true,
      choices: [
        { name: 'Auto: in for every wave unless I say out', value: 'auto' },
        { name: 'Opt-in: in only when I say so', value: 'opt_in' },
        { name: 'Not assaulting: out unless I say in', value: 'none' },
      ],
    },
    { name: 'ign', type: 3, description: 'One of your characters (default: all on a roster)', required: false, autocomplete: true },
  ],
};
