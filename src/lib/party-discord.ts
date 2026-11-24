/**
 * Party finder Discord commands (Dream Hub step 16): /party, /lfg, /league + the 🙋 Ask to join button,
 * the /lfg skill picker and the /league import modal. Routed from /api/discord/interactions,
 * registered with registerHubCommands(). Works for any Discord user, no website account needed.
 */
import { NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase-server';
import { createForumPost, editOriginalInteractionResponse, getChannel, patchThread, postToChannelRich } from '@/lib/discord-api';
import { bindLive, getLiveRow, messageLink } from '@/lib/discord-live';
import {
  ASK_PREFIX, LEAGUE_SKILLS, PARTY_BOARD_KEY, PARTY_FORUM_ID, PARTY_MAX, PARTY_STAFF_ROLE_ID, RESTRICTIONS, SEEKER_DAYS, SLAYER_SKILL,
  activeSeekers, discordInfo, getLeague, getParty, importLeagues, isPartyStaff, leagueLabel, leagueState, listLiveLeagues, loadParties,
  characterInfo, isLocked, maybeRestricted, memberLabel, openPartyOfCharacter, openSlots, parseLeagueList, partiesOf, partyByThread, refreshPartyBoard, syncPartyCard, todayUtc,
  type PartyFull, type Restriction, type Seeker,
} from '@/lib/party';

const EPHEMERAL = 64;
type Opt = { name: string; type?: number; value?: string | number | boolean; focused?: boolean; options?: Opt[] };
export interface PartyInteraction {
  token: string;
  application_id: string;
  channel_id?: string;
  member?: { user?: { id: string; username: string; global_name?: string | null }; roles?: string[] };
  user?: { id: string; username: string; global_name?: string | null };
  data: {
    name?: string;
    options?: Opt[];
    custom_id?: string;
    values?: string[];
    components?: Array<{ components?: Array<{ custom_id?: string; value?: string }> }>;
  };
}

const caller = (i: PartyInteraction) => i.member?.user ?? i.user;
const ephemeral = (content: string, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ type: 4, data: { content, flags: EPHEMERAL, allowed_mentions: { parse: [] }, ...extra } });
const safe = (s: string) => s.replace(/[*_`~|>#\[\]()@<]/g, '').replace(/\s+/g, ' ').trim();

function deferred(i: PartyInteraction, work: () => Promise<Record<string, unknown>>) {
  waitUntil(
    (async () => {
      let payload: Record<string, unknown>;
      try {
        payload = await work();
      } catch (err) {
        console.error('[party-discord]', err);
        payload = { content: `Something went wrong: ${String(err).slice(0, 300)}` };
      }
      await editOriginalInteractionResponse(i.application_id, i.token, { allowed_mentions: { parse: [] }, ...payload });
    })()
  );
  return NextResponse.json({ type: 5, data: { flags: EPHEMERAL } });
}

/** Card + board after a change; errors are reported, never thrown. */
async function afterChange(supabase: SupabaseClient, p: PartyFull | null) {
  const notes: string[] = [];
  if (p) {
    const fresh = (await getParty(supabase, p.id)) ?? p;
    const r = await syncPartyCard(supabase, fresh);
    if (!r.ok) notes.push(`⚠️ Party card not updated: ${r.error?.slice(0, 150)}`);
    p.thread_id = fresh.thread_id;
  }
  const b = await refreshPartyBoard(supabase);
  if (b.status === 'error') notes.push(`⚠️ Board not updated: ${b.error?.slice(0, 150)}`);
  return notes.length ? `\n-# ${notes.join(' · ')}` : '';
}

const subOf = (i: PartyInteraction) => i.data.options?.[0];
const optOf = (sub: Opt | undefined) => (n: string) => sub?.options?.find((o) => o.name === n)?.value;

// ─── Which party does the caller mean? ───────────────────────────────────────

async function resolveParty(supabase: SupabaseClient, i: PartyInteraction, partyOpt: unknown): Promise<PartyFull | string> {
  if (partyOpt) return (await getParty(supabase, String(partyOpt))) ?? 'That party does not exist (anymore).';
  if (i.channel_id) {
    const here = await partyByThread(supabase, i.channel_id);
    if (here) return here;
  }
  const mine = await partiesOf(supabase, caller(i)!.id);
  if (mine.length === 1) return mine[0]!;
  if (!mine.length) return 'You are not in a party. Run this inside a party thread, pick one with `party:`, or start one with `/party create`.';
  return `You are in ${mine.length} parties (${mine.map((p) => p.name).join(', ')}). Pick one with \`party:\` or run it inside the party thread.`;
}

/** Caller's best rank in the party over all their characters. */
const rankIn = (p: PartyFull, discordId: string) => {
  const ranks = p.members.filter((m) => m.discord_id === discordId).map((m) => m.rank);
  return ranks.includes('leader') ? 'leader' : ranks.includes('officer') ? 'officer' : ranks.length ? 'member' : null;
};
const canManage = (p: PartyFull, i: PartyInteraction) => ['leader', 'officer'].includes(rankIn(p, caller(i)!.id) ?? '') || isPartyStaff(i.member?.roles);
const isLeader = (p: PartyFull, i: PartyInteraction) => p.leader_discord_id === caller(i)!.id || isPartyStaff(i.member?.roles);
const findChar = (p: PartyFull, ign: string) => p.members.find((m) => m.ign?.toLowerCase() === ign.trim().toLowerCase()) ?? null;

/** A character by IGN: a Dream character when we know it (canonical name, Discord), else the typed name. */
async function resolveCharacter(supabase: SupabaseClient, raw: string) {
  const ign = raw.trim().replace(/[^A-Za-z0-9 _-]/g, '').slice(0, 40);
  if (!ign) return null;
  const { data } = await supabase.from('members').select('id, ign, discord_id').ilike('ign', ign.replace(/[%_\\]/g, '\\$&')).eq('is_active', true).limit(1);
  const m = data?.[0];
  return m ? { ign: m.ign as string, member_id: m.id as string, discord_id: (m.discord_id as string | null) ?? null } : { ign, member_id: null, discord_id: null };
}

/** Add a character, or fill a legacy "character not set" row of the same Discord user. */
async function addCharacter(supabase: SupabaseClient, p: PartyFull, ch: { ign: string; member_id: string | null; discord_id: string | null }, rank: 'leader' | 'member'): Promise<string | null> {
  if (findChar(p, ch.ign)) return `**${ch.ign}** is already in **${p.name}**.`;
  const other = await openPartyOfCharacter(supabase, ch.ign);
  if (other && other.party_id !== p.id) return `**${ch.ign}** is already in **${other.name}**. A character can be in one party at a time: \`/party leave ign:${ch.ign}\` there first.`;
  const legacy = ch.discord_id ? p.members.find((m) => !m.ign && m.discord_id === ch.discord_id) : undefined;
  if (legacy) {
    const { error } = await supabase.from('party_members').update({ ign: ch.ign, member_id: ch.member_id }).eq('id', legacy.id);
    return error ? `❌ ${error.message}` : null;
  }
  if (p.members.length >= PARTY_MAX) return `**${p.name}** is full (${PARTY_MAX}/${PARTY_MAX}).`;
  const { error } = await supabase.from('party_members').insert({ party_id: p.id, ign: ch.ign, member_id: ch.member_id, discord_id: ch.discord_id, rank });
  return error ? `❌ ${error.message}` : null;
}

// ─── Autocomplete ────────────────────────────────────────────────────────────

export async function handlePartyAutocomplete(i: PartyInteraction) {
  const sub = subOf(i);
  const focused = sub?.options?.find((o) => o.focused);
  const q = String(focused?.value ?? '').toLowerCase();
  const supabase = createAdminClient();
  let choices: Array<{ name: string; value: string }> = [];
  if (focused?.name === 'league') {
    const today = todayUtc();
    choices = (await listLiveLeagues(supabase))
      .map((l) => ({ name: `${leagueLabel(l)}${leagueState(l, today) === 'active' ? ' · running' : ''}`, value: l.id }))
      .filter((c) => c.name.toLowerCase().includes(q));
  } else if (focused?.name === 'party') {
    choices = (await loadParties(supabase))
      .map((p) => ({ name: `${p.verified ? '💤 ' : ''}${p.name} (${p.members.length}/${PARTY_MAX})`, value: p.id }))
      .filter((c) => c.name.toLowerCase().includes(q));
  } else if (focused?.name === 'ign' && ['kick', 'rank', 'leave'].includes(sub?.name ?? '')) {
    // Characters already in the party (leave: only your own).
    const p = await resolveParty(supabase, i, sub?.options?.find((o) => o.name === 'party')?.value);
    if (typeof p !== 'string') {
      choices = p.members
        .filter((m) => m.ign && (sub?.name !== 'leave' || m.discord_id === caller(i)?.id))
        .map((m) => ({ name: `${m.ign} (${m.rank})`, value: m.ign! }))
        .filter((c) => c.name.toLowerCase().includes(q));
    }
  } else if (focused?.name === 'ign' && i.data.name === 'lfg') {
    const { data } = await supabase.from('members').select('ign, combat_level').eq('discord_id', caller(i)?.id ?? '').eq('is_active', true).order('ign');
    choices = (data ?? []).map((m) => ({ name: `${m.ign}${m.combat_level ? ` · CL ${m.combat_level}` : ''}`, value: m.ign as string })).filter((c) => c.name.toLowerCase().includes(q));
    if (q && !choices.some((c) => c.value.toLowerCase() === q)) choices.unshift({ name: `${String(focused?.value)} (outside Dream 🌐)`, value: String(focused?.value) });
  } else if (focused?.name === 'ign') {
    // Any Dream character; your own first. Free text (non-Dream characters) is allowed too.
    const me = caller(i)?.id;
    const { data } = await supabase
      .from('members')
      .select('ign, discord_id, combat_level')
      .eq('is_active', true)
      .ilike('ign', `%${q.replace(/[%_\\]/g, '\\$&')}%`)
      .order('ign')
      .limit(50);
    choices = (data ?? [])
      .sort((a, b) => Number(b.discord_id === me) - Number(a.discord_id === me))
      .map((m) => ({ name: `${m.ign}${m.combat_level ? ` · CL ${m.combat_level}` : ''}${m.discord_id === me ? ' · you' : ''}`, value: m.ign as string }));
    if (q && !choices.some((c) => c.value.toLowerCase() === q)) choices.unshift({ name: `${String(focused?.value)} (outside Dream 🌐)`, value: String(focused?.value) });
  }
  return NextResponse.json({ type: 8, data: { choices: choices.slice(0, 25).map((c) => ({ name: c.name.slice(0, 100), value: c.value.slice(0, 100) })) } });
}

// ─── /party ──────────────────────────────────────────────────────────────────

export function handleParty(i: PartyInteraction) {
  const u = caller(i);
  if (!u) return ephemeral('Could not identify you.');
  const sub = subOf(i);
  const opt = optOf(sub);
  const staff = isPartyStaff(i.member?.roles);

  return deferred(i, async () => {
    const supabase = createAdminClient();

    if (sub?.name === 'create') {
      const name = safe(String(opt('name') ?? '')).slice(0, 60);
      if (!name) return { content: 'Give the party a `name:` (your in-game party name).' };
      const leaderOpt = opt('leader') as string | undefined;
      if (leaderOpt && leaderOpt !== u.id && !staff) return { content: `Only <@&${PARTY_STAFF_ROLE_ID}> can create a party for someone else.` };
      const leader = leaderOpt ?? u.id;

      // Leader character (required).
      const ch = await resolveCharacter(supabase, String(opt('ign') ?? ''));
      if (!ch) return { content: 'Which character leads the party? Add `ign:` (in-game name).' };
      if (ch.discord_id && ch.discord_id !== leader) return { content: `**${ch.ign}** belongs to <@${ch.discord_id}>, not the leader.` };
      ch.discord_id = ch.discord_id ?? leader;
      const busy = await openPartyOfCharacter(supabase, ch.ign);
      if (busy) return { content: `**${ch.ign}** is already in **${busy.name}**. A character can be in one party at a time.` };

      // Inside a #league-party-find thread: adopt it (its creator or staff only).
      let threadId: string | null = null;
      const here = i.channel_id ? await getChannel(i.channel_id) : null;
      if (here?.parent_id === PARTY_FORUM_ID) {
        if (await partyByThread(supabase, here.id)) return { content: 'This thread already belongs to a party: `/party info`.' };
        await supabase.from('parties').delete().eq('thread_id', here.id).not('closed_at', 'is', null); // old closed party
        const board = await getLiveRow(supabase, PARTY_BOARD_KEY);
        if (board?.channel_id === here.id) return { content: 'Not in the party board 🙂' };
        if (here.owner_id !== u.id && !staff) return { content: `Only the person who opened this thread (<@${here.owner_id}>) or <@&${PARTY_STAFF_ROLE_ID}> can attach it to a party.` };
        threadId = here.id;
      }

      const { data, error } = await supabase
        .from('parties')
        .insert({ name, leader_discord_id: leader, created_by: u.id, thread_id: threadId })
        .select('id')
        .single();
      if (error) return { content: `❌ ${error.message}` };
      await supabase.from('party_members').insert({ party_id: data.id, ign: ch.ign, member_id: ch.member_id, discord_id: ch.discord_id, rank: 'leader' });
      const p = (await getParty(supabase, data.id as string))!;
      const note = await afterChange(supabase, p);
      return {
        content: [
          `✅ Party **${name}** ${threadId ? 'attached to this thread' : `created: <#${p.thread_id}>`}, led by **${ch.ign}** (<@${ch.discord_id}>).`,
          'Next: `/party invite ign:` each character (alts too), `/party league` the leagues you plan, `/party edit slayer:open` if you do party Slayer.',
        ].join('\n') + note,
      };
    }

    const resolved = await resolveParty(supabase, i, opt('party'));
    if (typeof resolved === 'string') return { content: resolved };
    const p = resolved;

    if (sub?.name === 'info') {
      const leagues = p.leagues.filter((x) => leagueState(x.league) !== 'ended');
      return {
        content: [
          `**${p.verified ? '💤 ' : ''}${p.name}**${p.thread_id ? ` · <#${p.thread_id}>` : ''}`,
          ...p.members.map((m) => `${m.rank === 'leader' ? '👑' : m.rank === 'officer' ? '⭐' : '👤'} ${memberLabel(m)}`),
          `${p.members.length}/${PARTY_MAX}${p.slayer ? ' · 🗡️ party Slayer' : ''}`,
          ...leagues.map((x) => `• ${leagueLabel(x.league)} · ${x.status === 'joined' ? '✅ joined' : 'planning'}`),
          p.note ? `📝 ${p.note}` : '',
        ].filter(Boolean).join('\n'),
      };
    }

    if (sub?.name === 'leave') {
      const ign = opt('ign') as string | undefined;
      const mine = p.members.filter((m) => m.discord_id === u.id && (!ign || m.ign?.toLowerCase() === ign.toLowerCase()));
      if (!mine.length) return { content: ign ? `**${safe(ign)}** is not one of your characters in **${p.name}**.` : `You have no characters in **${p.name}**.` };
      const leaving = mine.filter((m) => m.rank !== 'leader');
      if (!leaving.length) return { content: 'The leader character can\'t leave (same as in game): `/party close` instead.' };
      for (const m of leaving) await supabase.from('party_members').delete().eq('id', m.id);
      const kept = mine.length - leaving.length;
      return { content: `👋 ${leaving.map((m) => m.ign ?? 'your character').join(', ')} left **${p.name}**.${kept ? ' (Your leader character stays.)' : ''}` + (await afterChange(supabase, p)) };
    }

    if (sub?.name === 'verify') {
      if (!staff) return { content: `Only <@&${PARTY_STAFF_ROLE_ID}> can verify Dream parties.` };
      await supabase.from('parties').update({ verified: !p.verified }).eq('id', p.id);
      return { content: `${!p.verified ? '💤 Verified' : 'Unverified'} **${p.name}**.` + (await afterChange(supabase, p)) };
    }

    if (sub?.name === 'close') {
      if (!isLeader(p, i)) return { content: 'Only the party leader (or staff) can close the party.' };
      // Card shows "closed" one last time, then the party is deleted: characters and thread are free again.
      p.closed_at = new Date().toISOString();
      await syncPartyCard(supabase, { ...p, leagues: [] });
      const { error } = await supabase.from('parties').delete().eq('id', p.id);
      if (error) return { content: `❌ ${error.message}` };
      const b = await refreshPartyBoard(supabase);
      return { content: `🔒 **${p.name}** closed and deleted. Its characters are free, and \`/party create\` in this thread starts a new party.${b.status === 'error' ? `\n-# ⚠️ Board: ${b.error}` : ''}` };
    }

    if (!canManage(p, i)) return { content: `Only the leader and officers of **${p.name}** can do that.` };

    if (sub?.name === 'invite') {
      const ch = await resolveCharacter(supabase, String(opt('ign') ?? ''));
      if (!ch) return { content: 'Which character? `ign:`' };
      const userOpt = opt('user') as string | undefined;
      if (userOpt) ch.discord_id = userOpt;
      const err = await addCharacter(supabase, p, ch, 'member');
      if (err) return { content: err };
      await supabase.from('party_seekers').delete().ilike('ign', ch.ign.replace(/[%_\\]/g, '\\$&')); // found a party
      const note = await afterChange(supabase, p);
      const who = ch.discord_id ? `**${ch.ign}** (<@${ch.discord_id}>)` : `**${ch.ign}**`;
      if (p.thread_id) {
        await postToChannelRich(p.thread_id, {
          content: `👋 ${who} joined **${p.name}** (added by <@${u.id}>). Don't forget the in-game invite!`,
          allowed_mentions: { users: ch.discord_id && ch.discord_id !== u.id ? [ch.discord_id] : [] },
        });
      }
      return { content: `✅ Added ${who} to **${p.name}**.${ch.member_id ? '' : `\n-# 🌐 **${ch.ign}** is from outside the Dream guilds.${ch.discord_id ? '' : ' If they are on this server, add `user:` so they get pinged and can use `/party leave`.'}`}` + note };
    }

    if (sub?.name === 'kick') {
      const m = findChar(p, String(opt('ign') ?? ''));
      if (!m) return { content: `No character **${safe(String(opt('ign') ?? ''))}** in **${p.name}**.` };
      if (m.rank === 'leader') return { content: 'The leader can\'t be removed. Close the party instead.' };
      if (m.rank === 'officer' && !isLeader(p, i)) return { content: 'Only the leader can remove an officer.' };
      await supabase.from('party_members').delete().eq('id', m.id);
      return { content: `Removed **${m.ign}** from **${p.name}**.` + (await afterChange(supabase, p)) };
    }

    if (sub?.name === 'rank') {
      if (!isLeader(p, i)) return { content: 'Only the leader can change ranks (same as in game).' };
      const m = findChar(p, String(opt('ign') ?? ''));
      if (!m) return { content: `No character **${safe(String(opt('ign') ?? ''))}** in **${p.name}**.` };
      if (m.rank === 'leader') return { content: 'Leadership can\'t be handed over (same as in game).' };
      const rank = opt('rank') === 'officer' ? 'officer' : 'member';
      await supabase.from('party_members').update({ rank }).eq('id', m.id);
      return { content: `**${m.ign}** is now ${rank === 'officer' ? 'an ⭐ officer' : 'a member'} of **${p.name}**.` + (await afterChange(supabase, p)) };
    }

    if (sub?.name === 'league') {
      const status = opt('status') === 'joined' ? 'joined' : 'planning';
      return leaguePicker(supabase, p, status);
    }

    if (sub?.name === 'edit') {
      const patch: Record<string, unknown> = {};
      const name = opt('name');
      if (name !== undefined) {
        const n = safe(String(name)).slice(0, 60);
        if (!n) return { content: 'Name can\'t be empty.' };
        patch.name = n;
      }
      const note = opt('note');
      if (note !== undefined) patch.note = String(note).trim() === '-' ? null : safe(String(note)).slice(0, 200) || null;
      const slayer = opt('slayer');
      if (slayer !== undefined) patch.slayer = slayer === 'open';
      if (!Object.keys(patch).length) return { content: 'Nothing to change: use `name:`, `note:` (`-` clears it) or `slayer:`.' };
      await supabase.from('parties').update(patch).eq('id', p.id);
      if (patch.name && p.thread_id) await patchThread(p.thread_id, { name: String(patch.name) });
      return { content: `✅ Updated **${patch.name ?? p.name}**.` + (await afterChange(supabase, p)) };
    }

    return { content: 'Unknown subcommand.' };
  });
}

// ─── 🙋 Ask to join (button on the party card) ───────────────────────────────
// Asks WHICH character: the only free one directly, else a picker (+ "another character" → modal).
// Nobody mapped (e.g. outside Dream) → modal straight away.

const ASK_CHAR = 'party:askc:';
const ASK_MODAL = 'party:askm:';
const OTHER = '__other';

/** Caller's Dream characters that are not in an open party yet. */
async function freeCharacters(supabase: SupabaseClient, discordId: string) {
  const { data } = await supabase.from('members').select('id, ign, combat_level').eq('discord_id', discordId).eq('is_active', true).order('ign');
  const out: Array<{ ign: string; cl: number | null }> = [];
  for (const c of data ?? []) if (!(await openPartyOfCharacter(supabase, c.ign as string))) out.push({ ign: c.ign as string, cl: (c.combat_level as number | null) ?? null });
  return out;
}

const askModal = (partyId: string) =>
  NextResponse.json({
    type: 9,
    data: {
      custom_id: `${ASK_MODAL}${partyId}`,
      title: 'Ask to join',
      components: [{ type: 1, components: [{ type: 4, custom_id: 'ign', style: 1, label: 'Your character name (in game)', required: true, min_length: 2, max_length: 40 }] }],
    },
  });

async function askBlocker(p: PartyFull | null): Promise<string | null> {
  if (!p || p.closed_at) return 'This party is closed.';
  if (!p.thread_id) return 'This party has no thread.';
  if (isLocked(p)) return 'This party joined a league in game and is locked: no new members until it ends.';
  if (p.members.length >= PARTY_MAX) return 'This party is full.';
  return null;
}

/** Post the request in the party thread for one character. */
async function postAsk(supabase: SupabaseClient, partyId: string, discordId: string, rawIgn: string): Promise<Record<string, unknown>> {
  const p = await getParty(supabase, partyId);
  const blocked = await askBlocker(p);
  if (blocked) return { content: blocked };
  const ch = await resolveCharacter(supabase, rawIgn);
  if (!ch) return { content: 'Which character? Type its in-game name.' };
  if (ch.discord_id && ch.discord_id !== discordId) return { content: `**${ch.ign}** belongs to someone else.` };
  if (findChar(p!, ch.ign)) return { content: `**${ch.ign}** is already in **${p!.name}**.` };
  const busy = await openPartyOfCharacter(supabase, ch.ign);
  if (busy) return { content: `**${ch.ign}** is already in **${busy.name}**. Leave that party first (\`/party leave ign:${ch.ign}\`).` };
  const info = (await characterInfo(supabase, [ch.ign])).get(ch.ign.toLowerCase());
  const about = [info?.cl ? `CL ${info.cl}` : null, info?.tag ?? (ch.member_id ? null : '🌐 outside Dream')].filter(Boolean).join(' · ');
  const staffIds = Array.from(new Set(p!.members.filter((m) => m.rank !== 'member' && m.discord_id).map((m) => m.discord_id!)));
  const r = await postToChannelRich(p!.thread_id!, {
    content: `🙋 **${ch.ign}**${about ? ` (${about})` : ''} · <@${discordId}> would like to join **${p!.name}**. ${staffIds.map((d) => `<@${d}>`).join(' ')}\n-# Leader/officers: invite in game, then \`/party invite ign:${ch.ign}\`${ch.member_id ? '' : ` user:@them`}.`,
    allowed_mentions: { users: staffIds },
  });
  return { content: r.ok ? `✅ Asked with **${ch.ign}** in <#${p!.thread_id}>. The leader will get back to you there.` : `❌ Could not post in the thread: ${r.error}` };
}

export async function handlePartyAsk(i: PartyInteraction) {
  const u = caller(i);
  if (!u) return ephemeral('Could not identify you.');
  const partyId = String(i.data.custom_id ?? '').slice(ASK_PREFIX.length);
  const supabase = createAdminClient();
  const p = await getParty(supabase, partyId);
  const blocked = await askBlocker(p);
  if (blocked) return ephemeral(blocked);
  const chars = await freeCharacters(supabase, u.id);
  if (!chars.length) return askModal(partyId);
  if (chars.length === 1) return deferred(i, () => postAsk(supabase, partyId, u.id, chars[0]!.ign));
  const options = [
    ...chars.slice(0, 24).map((c) => ({ label: c.ign, value: c.ign, description: c.cl ? `CL ${c.cl}` : undefined })),
    { label: 'Another character…', value: OTHER, description: 'Type a name (e.g. a character outside Dream)' },
  ];
  return ephemeral(`Which character wants to join **${p!.name}**?`, {
    components: [{ type: 1, components: [{ type: 3, custom_id: `${ASK_CHAR}${partyId}`, placeholder: 'Character…', options }] }],
  });
}

export function handleAskChar(i: PartyInteraction) {
  const u = caller(i);
  if (!u) return ephemeral('Could not identify you.');
  const partyId = String(i.data.custom_id ?? '').slice(ASK_CHAR.length);
  const ign = i.data.values?.[0] ?? '';
  if (ign === OTHER) return askModal(partyId);
  return deferred(i, () => postAsk(createAdminClient(), partyId, u.id, ign));
}

export function handleAskModal(i: PartyInteraction) {
  const u = caller(i);
  if (!u) return ephemeral('Could not identify you.');
  const partyId = String(i.data.custom_id ?? '').slice(ASK_MODAL.length);
  const ign = i.data.components?.[0]?.components?.find((c) => c.custom_id === 'ign')?.value ?? '';
  return deferred(i, () => postAsk(createAdminClient(), partyId, u.id, ign));
}

// ─── /party league picker ────────────────────────────────────────────────────
// One multi-select of all running + upcoming leagues, current ones ticked. Submitting saves the
// selection: ticked = kept/added with the chosen status, unticked = dropped.
// custom_id = party:lg:<party id>:<p|j>

const LEAGUE_PICK = 'party:lg:';

async function leaguePicker(supabase: SupabaseClient, p: PartyFull, status: 'planning' | 'joined') {
  const today = todayUtc();
  const leagues = (await listLiveLeagues(supabase)).filter((l) => leagueState(l, today) !== 'ended');
  if (!leagues.length) return { content: 'No leagues imported yet (staff: `/league import`).' };
  const mine = new Map(p.leagues.map((x) => [x.league_id, x.status]));
  // Max 25 options: keep the party's current leagues, then the soonest others.
  const shown = [...leagues.filter((l) => mine.has(l.id)), ...leagues.filter((l) => !mine.has(l.id))].slice(0, 25)
    .sort((a, b) => a.starts_on.localeCompare(b.starts_on));
  const options = shown.map((l) => ({
    label: leagueLabel(l).slice(0, 100),
    value: l.id,
    description: `${leagueState(l, today) === 'active' ? 'running' : 'upcoming'}${l.entrants != null ? ` · ${l.entrants} parties` : ''}${mine.get(l.id) === 'joined' ? ' · ✅ joined' : mine.get(l.id) ? ' · planning' : ''}`.slice(0, 100),
    default: mine.has(l.id),
  }));
  return {
    content: [
      `**${p.name}**: tick every league you ${status === 'joined' ? '**joined in game**' : '**plan** to join'}, untick to drop.`,
      status === 'joined'
        ? '-# Joined = locked in game: the party shows no open slots anywhere while a joined league is upcoming or running.'
        : '-# New picks are saved as planning; leagues already marked joined stay joined. Run `/party league status:joined` once you registered in game.',
    ].join('\n'),
    components: [{ type: 1, components: [{ type: 3, custom_id: `${LEAGUE_PICK}${p.id}:${status === 'joined' ? 'j' : 'p'}`, placeholder: 'Leagues…', min_values: 0, max_values: options.length, options }] }],
  };
}

export function handleLeaguePick(i: PartyInteraction) {
  const u = caller(i);
  if (!u) return ephemeral('Could not identify you.');
  const [partyId, flag] = String(i.data.custom_id ?? '').slice(LEAGUE_PICK.length).split(':');
  const status = flag === 'j' ? 'joined' : 'planning';
  const picked = new Set(i.data.values ?? []);
  waitUntil(
    (async () => {
      const supabase = createAdminClient();
      const done = (content: string) => editOriginalInteractionResponse(i.application_id, i.token, { content, components: [], allowed_mentions: { parse: [] } });
      try {
        const p = await getParty(supabase, partyId ?? '');
        if (!p) return void (await done('This party no longer exists.'));
        if (!canManage(p, i)) return void (await done(`Only the leader and officers of **${p.name}** can do that.`));
        const today = todayUtc();
        const live = new Map((await listLiveLeagues(supabase)).map((l) => [l.id, l]));
        const now = new Date().toISOString();
        // Drop unticked (only leagues that are still running/upcoming; ended history stays).
        const drop = p.leagues.filter((x) => !picked.has(x.league_id) && leagueState(x.league, today) !== 'ended').map((x) => x.league_id);
        if (drop.length) await supabase.from('party_leagues').delete().eq('party_id', p.id).in('league_id', drop);
        const before = new Map(p.leagues.map((x) => [x.league_id, x.status]));
        const rows = Array.from(picked)
          .filter((id) => live.has(id))
          .map((id) => ({ party_id: p.id, league_id: id, status: status === 'joined' ? 'joined' : (before.get(id) ?? 'planning'), updated_at: now }));
        if (rows.length) {
          const { error } = await supabase.from('party_leagues').upsert(rows);
          if (error) return void (await done(`❌ ${error.message}`));
        }
        const note = await afterChange(supabase, p);
        const restricted = rows.map((r) => live.get(r.league_id)!).filter((l) => l.restriction);
        await done(
          [
            `✅ **${p.name}**: ${rows.length} league${rows.length === 1 ? '' : 's'}${drop.length ? `, ${drop.length} dropped` : ''}.`,
            ...rows.map((r) => `• ${leagueLabel(live.get(r.league_id)!)} · ${r.status === 'joined' ? '✅ joined' : 'planning'}`),
            ...restricted.map((l) => `-# 🔒 ${leagueLabel(l, { dates: false })}: only ${l.restriction} characters can join.`),
          ].join('\n').slice(0, 1900) + note
        );
      } catch (err) {
        await done(`Something went wrong: ${String(err).slice(0, 300)}`);
      }
    })()
  );
  return NextResponse.json({ type: 6 }); // deferred update of the picker message
}

// ─── /lfg (per character) ────────────────────────────────────────────────────

const LFG_PICK = 'party:lfg:';
const seekerExpiry = () => new Date(Date.now() + SEEKER_DAYS * 86400_000).toISOString();

function skillPicker(seekerId: string, selected: string[]) {
  const options = [SLAYER_SKILL, ...LEAGUE_SKILLS].map((s) => ({ label: s, value: s, default: selected.includes(s) }));
  return [{ type: 1, components: [{ type: 3, custom_id: `${LFG_PICK}${seekerId}`, placeholder: 'What are you looking for? (pick any)', min_values: 1, max_values: options.length, options }] }];
}

const seekerLine = (s: Seeker, info: Map<string, { cl: number | null; tag: string | null }>) => {
  const x = info.get(s.ign.toLowerCase());
  const bits = [x?.cl ? `CL ${x.cl}` : null, x?.tag ?? (s.member_id ? null : '🌐')].filter(Boolean).join(' · ');
  return `**${s.ign}**${bits ? ` (${bits})` : ''} · <@${s.discord_id}> · ${s.skills.join(', ') || 'anything'}${s.note ? ` · “${s.note}”` : ''}`;
};

export function handleLfg(i: PartyInteraction) {
  const u = caller(i);
  if (!u) return ephemeral('Could not identify you.');
  const sub = subOf(i);
  const opt = optOf(sub);
  return deferred(i, async () => {
    const supabase = createAdminClient();
    if (sub?.name === 'clear') {
      const ign = opt('ign') as string | undefined;
      let q = supabase.from('party_seekers').delete().eq('discord_id', u.id);
      if (ign) q = q.ilike('ign', ign.replace(/[%_\\]/g, '\\$&'));
      const { data } = await q.select('ign');
      await refreshPartyBoard(supabase);
      return { content: data?.length ? `✅ Off the list: ${data.map((r) => `**${r.ign}**`).join(', ')}.` : 'Nothing to remove.' };
    }
    if (sub?.name === 'list') {
      const seekers = await activeSeekers(supabase);
      if (!seekers.length) return { content: 'Nobody is looking right now.' };
      const info = await characterInfo(supabase, seekers.map((s) => s.ign));
      return { content: seekers.map((s) => seekerLine(s, info)).join('\n').slice(0, 1990) };
    }

    // set: which character (ign option, else your only Dream character)
    let ch = opt('ign') ? await resolveCharacter(supabase, String(opt('ign'))) : null;
    if (!ch) {
      const { data: own } = await supabase.from('members').select('id, ign').eq('discord_id', u.id).eq('is_active', true);
      if ((own ?? []).length !== 1) return { content: `Which character is looking? Add \`ign:\`${own?.length ? ` (${own.map((c) => c.ign).join(', ')})` : ' (your in-game name)'}. Run it once per alt to list several.` };
      ch = { ign: own![0]!.ign as string, member_id: own![0]!.id as string, discord_id: u.id };
    }
    if (ch.discord_id && ch.discord_id !== u.id) return { content: `**${ch.ign}** belongs to someone else.` };
    const busy = await openPartyOfCharacter(supabase, ch.ign);
    if (busy) return { content: `**${ch.ign}** is already in **${busy.name}**. \`/party leave ign:${ch.ign}\` first.` };

    const note = opt('note');
    const { data: existing } = await supabase.from('party_seekers').select('id, discord_id, skills').ilike('ign', ch.ign.replace(/[%_\\]/g, '\\$&')).maybeSingle();
    if (existing && existing.discord_id !== u.id) return { content: `**${ch.ign}** is already listed by <@${existing.discord_id}>.` };
    const values = {
      discord_id: u.id,
      ign: ch.ign,
      member_id: ch.member_id,
      expires_at: seekerExpiry(),
      updated_at: new Date().toISOString(),
      ...(note !== undefined ? { note: safe(String(note)).slice(0, 200) || null } : {}),
    };
    const saved = existing
      ? await supabase.from('party_seekers').update(values).eq('id', existing.id).select('id, skills').single()
      : await supabase.from('party_seekers').insert(values).select('id, skills').single();
    if (saved.error) return { content: `❌ ${saved.error.message}` };
    return {
      content: `What is **${ch.ign}** looking for? Listed on the 📋 Party board for ${SEEKER_DAYS} days (\`/lfg set\` again renews, \`/lfg clear\` removes). Other alts: run \`/lfg set ign:\` for each.`,
      components: skillPicker(saved.data.id as string, (saved.data.skills as string[]) ?? []),
    };
  });
}

export async function handleLfgPick(i: PartyInteraction) {
  const u = caller(i);
  if (!u) return ephemeral('Could not identify you.');
  const seekerId = String(i.data.custom_id ?? '').slice(LFG_PICK.length);
  const allowed = new Set<string>([SLAYER_SKILL, ...LEAGUE_SKILLS]);
  const skills = (i.data.values ?? []).filter((v) => allowed.has(v));
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('party_seekers')
    .update({ skills, expires_at: seekerExpiry(), updated_at: new Date().toISOString() })
    .eq('id', seekerId)
    .eq('discord_id', u.id)
    .select('ign');
  waitUntil(refreshPartyBoard(supabase).catch(() => undefined));
  const until = Math.floor(Date.parse(seekerExpiry()) / 1000);
  return NextResponse.json({
    type: 7,
    data: {
      content: error ? `❌ ${error.message}` : !data?.length ? 'That listing is gone, run `/lfg set` again.' : `✅ **${data[0]!.ign}** listed as looking for: **${skills.join(', ')}** until <t:${until}:D>.`,
      components: [],
    },
  });
}

// ─── /league ─────────────────────────────────────────────────────────────────

const IMPORT_MODAL = 'party:import';

export function handleLeague(i: PartyInteraction) {
  const u = caller(i);
  if (!u) return ephemeral('Could not identify you.');
  const sub = subOf(i);
  const opt = optOf(sub);
  const staff = isPartyStaff(i.member?.roles);
  const denied = () => ephemeral(`Only <@&${PARTY_STAFF_ROLE_ID}> can do that.`);

  if (sub?.name === 'import') {
    if (!staff) return denied();
    return NextResponse.json({
      type: 9,
      data: {
        custom_id: IMPORT_MODAL,
        title: 'Import leagues',
        components: [{
          type: 1,
          components: [{
            type: 4,
            custom_id: 'text',
            style: 2,
            label: 'Paste the in-game league list',
            placeholder: 'Alchemy\nAlchemy\nExperience    4    Nov 25 - Dec 23    Upcoming    15\n…',
            required: true,
            max_length: 4000,
          }],
        }],
      },
    });
  }

  return deferred(i, async () => {
    const supabase = createAdminClient();

    if (sub?.name === 'list') {
      const today = todayUtc();
      const [leagues, parties] = await Promise.all([listLiveLeagues(supabase), loadParties(supabase)]);
      if (!leagues.length) return { content: 'No leagues imported yet.' };
      const line = (l: (typeof leagues)[number]) => {
        const ps = parties.filter((p) => p.leagues.some((x) => x.league_id === l.id));
        return `• **${leagueLabel(l)}**${l.entrants != null ? ` · ${l.entrants} parties` : ''}${ps.length ? ` · Dream: ${ps.map((p) => (p.thread_id ? `<#${p.thread_id}>` : p.name)).join(', ')}` : ''}`;
      };
      const active = leagues.filter((l) => leagueState(l, today) === 'active');
      const upcoming = leagues.filter((l) => leagueState(l, today) === 'upcoming');
      return {
        content: [
          ...(active.length ? ['**🔥 Running**', ...active.map(line)] : []),
          ...(upcoming.length ? ['', '**⏳ Upcoming**', ...upcoming.map(line)] : []),
          '',
          '-# Plan one with `/party league`. Looking for a party? `/lfg set`.',
        ].join('\n').slice(0, 1990),
      };
    }

    if (!staff) return { content: `Only <@&${PARTY_STAFF_ROLE_ID}> can do that.` };

    if (sub?.name === 'restrict') {
      const league = await getLeague(supabase, String(opt('league') ?? ''));
      if (!league) return { content: 'Pick a league from the list.' };
      const type = String(opt('type') ?? 'none');
      const restriction = (RESTRICTIONS as readonly string[]).includes(type) ? (type as Restriction) : null;
      await supabase.from('leagues').update({ restriction, updated_at: new Date().toISOString() }).eq('id', league.id);
      await refreshPartyBoard(supabase);
      return { content: `✅ ${leagueLabel({ ...league, restriction })}${restriction ? '' : ' (open to everyone)'}` };
    }

    if (sub?.name === 'remove') {
      const league = await getLeague(supabase, String(opt('league') ?? ''));
      if (!league) return { content: 'Pick a league from the list.' };
      await supabase.from('leagues').delete().eq('id', league.id);
      await refreshPartyBoard(supabase);
      return { content: `🗑️ Removed ${leagueLabel(league)}.` };
    }

    if (sub?.name === 'board') {
      const row = await getLiveRow(supabase, PARTY_BOARD_KEY);
      let threadId = row?.channel_id ?? null;
      if (threadId && !(await getChannel(threadId))) threadId = null; // thread deleted → new one
      if (!threadId) {
        const post = await createForumPost(PARTY_FORUM_ID, '📋 Party board', {
          content: '**📋 Dream party board**: every Dream party, upcoming leagues and who is looking. DreamBot keeps it up to date below.\n-# `/party create` · `/lfg set` · `/league list`',
          allowed_mentions: { parse: [] },
        });
        if (!post.ok || !post.threadId) return { content: `❌ Could not create the board post: ${post.error}` };
        threadId = post.threadId;
        await bindLive(supabase, PARTY_BOARD_KEY, threadId);
      }
      const pin = await patchThread(threadId, { locked: true, flags: 2, archived: false });
      const r = await refreshPartyBoard(supabase);
      return {
        content: [
          `${r.ok ? '✅' : '❌'} Party board: <#${threadId}>${r.message_ids[0] ? ` · ${messageLink(threadId, r.message_ids[0])}` : ''}${r.error ? ` · ${r.error}` : ''}`,
          pin.ok ? '-# Pinned to the top of the forum and locked (only DreamBot posts there).' : `-# ⚠️ Could not pin/lock it (DreamBot needs Manage Threads in #league-party-find): ${pin.error?.slice(0, 200)}`,
        ].join('\n'),
      };
    }

    return { content: 'Unknown subcommand.' };
  });
}

/** Modal submit of /league import. */
export function handleLeagueImport(i: PartyInteraction) {
  if (!isPartyStaff(i.member?.roles)) return ephemeral(`Only <@&${PARTY_STAFF_ROLE_ID}> can import leagues.`);
  const text = i.data.components?.[0]?.components?.find((c) => c.custom_id === 'text')?.value ?? '';
  return deferred(i, async () => {
    const supabase = createAdminClient();
    const { leagues, skipped } = parseLeagueList(text);
    if (!leagues.length) return { content: 'No leagues found in that paste. Copy the whole list from the in-game Leagues page (skill name + the "Experience 4 Nov 25 - Dec 23 Upcoming 15" row).' };
    const { added, updated } = await importLeagues(supabase, leagues);
    const all = [...added, ...updated].sort((a, b) => a.starts_on.localeCompare(b.starts_on));
    const flagged = maybeRestricted(all);
    const board = await refreshPartyBoard(supabase);
    return {
      content: [
        `✅ ${added.length} new, ${updated.length} updated league${updated.length === 1 ? '' : 's'}.`,
        ...all.map((l, idx) => `• ${leagueLabel(l)} · ${l.entrants ?? '?'} parties${added.includes(l) ? ' · 🆕' : ''}${flagged.has(idx) ? ' · ❓ few parties: restricted?' : ''}`),
        skipped.length ? `-# Skipped ${skipped.length} line(s) I could not read.` : '',
        '',
        'Restrictions (cursed / restricted / forsaken / banished) are not in the copied text: set them with `/league restrict`.',
        board.status === 'unbound' ? '-# No party board yet: `/league board`.' : board.status === 'error' ? `-# ⚠️ Board: ${board.error}` : '',
      ].filter(Boolean).join('\n').slice(0, 1990),
    };
  });
}

// ─── Routing + registration ──────────────────────────────────────────────────

export const PARTY_COMMANDS = new Set(['party', 'lfg', 'league']);

/** Returns a response for party-finder interactions, or null when it isn't one. */
export function routePartyInteraction(type: number, i: PartyInteraction): Promise<NextResponse> | NextResponse | null {
  const name = i.data.name ?? '';
  const id = i.data.custom_id ?? '';
  if (type === 4 && (name === 'party' || name === 'league' || name === 'lfg')) return handlePartyAutocomplete(i);
  if (type === 2 && name === 'party') return handleParty(i);
  if (type === 2 && name === 'lfg') return handleLfg(i);
  if (type === 2 && name === 'league') return handleLeague(i);
  if (type === 3 && id.startsWith(ASK_PREFIX)) return handlePartyAsk(i);
  if (type === 3 && id.startsWith(LFG_PICK)) return handleLfgPick(i);
  if (type === 3 && id.startsWith(ASK_CHAR)) return handleAskChar(i);
  if (type === 5 && id.startsWith(ASK_MODAL)) return handleAskModal(i);
  if (type === 3 && id.startsWith(LEAGUE_PICK)) return handleLeaguePick(i);
  if (type === 5 && id === IMPORT_MODAL) return handleLeagueImport(i);
  return null;
}

const partyOpt = { name: 'party', type: 3, description: 'Which party (default: this thread / your party)', required: false, autocomplete: true };
const leagueOpt = { name: 'league', type: 3, description: 'League (from the imported list)', required: true, autocomplete: true };

export const PARTY_COMMAND_DEFS = [
  {
    name: 'party',
    description: 'League / Slayer parties: create, invite, plan leagues (shows on the 📋 Party board)',
    options: [
      {
        name: 'create', type: 1, description: 'List your in-game party (run inside your #league-party-find thread to use it)',
        options: [
          { name: 'name', type: 3, description: 'Party name', required: true, max_length: 60 },
          { name: 'ign', type: 3, description: 'Leader character (in-game name)', required: true, autocomplete: true },
          { name: 'leader', type: 6, description: 'Staff: attach for someone else (default: you)', required: false },
        ],
      },
      {
        name: 'invite', type: 1, description: 'Add a character: alts or players from outside Dream too (leader/officers)',
        options: [
          { name: 'ign', type: 3, description: 'Character name (any player, also outside Dream)', required: true, autocomplete: true },
          { name: 'user', type: 6, description: 'Outside player: their Discord, if they are on this server', required: false },
          partyOpt,
        ],
      },
      { name: 'kick', type: 1, description: 'Remove a character (leader/officers)', options: [{ name: 'ign', type: 3, description: 'Character in the party', required: true, autocomplete: true }, partyOpt] },
      {
        name: 'league', type: 1, description: 'Pick the leagues your party plans or joined (one list, tick several)',
        options: [
          { name: 'status', type: 3, description: 'planning = still recruiting · joined = registered in game (party locked)', required: false, choices: [{ name: 'planning (show open slots)', value: 'planning' }, { name: 'joined in game (locked)', value: 'joined' }] },
          partyOpt,
        ],
      },
      {
        name: 'edit', type: 1, description: 'Name, note, party Slayer',
        options: [
          { name: 'slayer', type: 3, description: 'Open for party Slayer?', required: false, choices: [{ name: 'open for party Slayer', value: 'open' }, { name: 'no party Slayer', value: 'closed' }] },
          { name: 'note', type: 3, description: 'Short note on the board (- clears it)', required: false, max_length: 200 },
          { name: 'name', type: 3, description: 'New name', required: false, max_length: 60 },
          partyOpt,
        ],
      },
      { name: 'rank', type: 1, description: 'Make a character officer or member (leader)', options: [{ name: 'ign', type: 3, description: 'Character in the party', required: true, autocomplete: true }, { name: 'rank', type: 3, description: 'Rank', required: true, choices: [{ name: 'officer', value: 'officer' }, { name: 'member', value: 'member' }] }, partyOpt] },
      { name: 'info', type: 1, description: 'Show a party', options: [partyOpt] },
      { name: 'leave', type: 1, description: 'Take your character(s) out of a party', options: [{ name: 'ign', type: 3, description: 'Which character (default: all of yours except a leader)', required: false, autocomplete: true }, partyOpt] },
      { name: 'close', type: 1, description: 'Close the party (leader)', options: [partyOpt] },
      { name: 'verify', type: 1, description: 'Staff: mark / unmark as a verified Dream party', options: [partyOpt] },
    ],
  },
  {
    name: 'lfg',
    description: 'Looking for a league or Slayer party: list yourself on the 📋 Party board',
    options: [
      {
        name: 'set', type: 1, description: `List a character for ${SEEKER_DAYS} days and pick skills (once per alt)`,
        options: [
          { name: 'ign', type: 3, description: 'Which character (default: your only one)', required: false, autocomplete: true },
          { name: 'note', type: 3, description: 'e.g. "active daily"', required: false, max_length: 200 },
        ],
      },
      { name: 'clear', type: 1, description: 'Take a character off the list (default: all of yours)', options: [{ name: 'ign', type: 3, description: 'Which character', required: false, autocomplete: true }] },
      { name: 'list', type: 1, description: 'Who is looking right now' },
    ],
  },
  {
    name: 'league',
    description: 'In-game leagues and the Dream parties in them',
    options: [
      { name: 'list', type: 1, description: 'Running and upcoming leagues' },
      { name: 'import', type: 1, description: 'Staff: paste the in-game league list' },
      {
        name: 'restrict', type: 1, description: 'Staff: set a league\'s character restriction',
        options: [leagueOpt, { name: 'type', type: 3, description: 'Restriction', required: true, choices: [...RESTRICTIONS.map((r) => ({ name: r, value: r })), { name: 'none (open to all)', value: 'none' }] }],
      },
      { name: 'remove', type: 1, description: 'Staff: delete a wrongly imported league', options: [leagueOpt] },
      { name: 'board', type: 1, description: 'Staff: create or repair the 📋 Party board post' },
    ],
  },
];
