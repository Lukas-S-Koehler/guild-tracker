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
  maybeRestricted, openSlots, parseLeagueList, partiesOf, partyByThread, refreshPartyBoard, syncPartyCard, todayUtc,
  type PartyFull, type Restriction,
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

const rankIn = (p: PartyFull, id: string) => p.members.find((m) => m.discord_id === id)?.rank ?? null;
const canManage = (p: PartyFull, i: PartyInteraction) => ['leader', 'officer'].includes(rankIn(p, caller(i)!.id) ?? '') || isPartyStaff(i.member?.roles);
const isLeader = (p: PartyFull, i: PartyInteraction) => p.leader_discord_id === caller(i)!.id || isPartyStaff(i.member?.roles);

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
  }
  return NextResponse.json({ type: 8, data: { choices: choices.slice(0, 25).map((c) => ({ name: c.name.slice(0, 100), value: c.value })) } });
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

      // Inside a #league-party-find thread: adopt it (its creator or staff only).
      let threadId: string | null = null;
      const here = i.channel_id ? await getChannel(i.channel_id) : null;
      if (here?.parent_id === PARTY_FORUM_ID) {
        if (await partyByThread(supabase, here.id)) return { content: 'This thread already belongs to a party: `/party info`.' };
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
      await supabase.from('party_members').insert({ party_id: data.id, discord_id: leader, rank: 'leader' });
      const p = (await getParty(supabase, data.id as string))!;
      const note = await afterChange(supabase, p);
      return {
        content: [
          `✅ Party **${name}** ${threadId ? 'attached to this thread' : `created: <#${p.thread_id}>`} with <@${leader}> as leader.`,
          'Next: `/party invite user:` your members, `/party league` the leagues you plan, `/party edit slayer:open` if you do party Slayer.',
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
          p.members.map((m) => `${m.rank === 'leader' ? '👑' : m.rank === 'officer' ? '⭐' : '👤'} <@${m.discord_id}>`).join(' · '),
          `${p.members.length}/${PARTY_MAX}${p.slayer ? ' · 🗡️ party Slayer' : ''}`,
          ...leagues.map((x) => `• ${leagueLabel(x.league)} · ${x.status === 'joined' ? '✅ joined' : 'planning'}`),
          p.note ? `📝 ${p.note}` : '',
        ].filter(Boolean).join('\n'),
      };
    }

    if (sub?.name === 'leave') {
      const r = rankIn(p, u.id);
      if (!r) return { content: `You are not in **${p.name}**.` };
      if (r === 'leader') return { content: 'Leaders can\'t leave (same as in game): `/party close` instead.' };
      await supabase.from('party_members').delete().eq('party_id', p.id).eq('discord_id', u.id);
      return { content: `👋 You left **${p.name}**.` + (await afterChange(supabase, p)) };
    }

    if (sub?.name === 'verify') {
      if (!staff) return { content: `Only <@&${PARTY_STAFF_ROLE_ID}> can verify Dream parties.` };
      await supabase.from('parties').update({ verified: !p.verified }).eq('id', p.id);
      return { content: `${!p.verified ? '💤 Verified' : 'Unverified'} **${p.name}**.` + (await afterChange(supabase, p)) };
    }

    if (sub?.name === 'close') {
      if (!isLeader(p, i)) return { content: 'Only the party leader (or staff) can close the party.' };
      await supabase.from('parties').update({ closed_at: new Date().toISOString() }).eq('id', p.id);
      p.closed_at = new Date().toISOString();
      await syncPartyCard(supabase, { ...p, members: p.members, leagues: [] });
      const b = await refreshPartyBoard(supabase);
      return { content: `🔒 **${p.name}** closed and removed from the board. The thread stays.${b.status === 'error' ? `\n-# ⚠️ Board: ${b.error}` : ''}` };
    }

    if (!canManage(p, i)) return { content: `Only the leader and officers of **${p.name}** can do that.` };

    if (sub?.name === 'invite') {
      const target = String(opt('user') ?? '');
      if (rankIn(p, target)) return { content: `<@${target}> is already in **${p.name}**.` };
      if (p.members.length >= PARTY_MAX) return { content: `**${p.name}** is full (${PARTY_MAX}/${PARTY_MAX}).` };
      const { error } = await supabase.from('party_members').insert({ party_id: p.id, discord_id: target, rank: 'member' });
      if (error) return { content: `❌ ${error.message}` };
      await supabase.from('party_seekers').delete().eq('discord_id', target); // found a party
      const note = await afterChange(supabase, p);
      if (p.thread_id) {
        await postToChannelRich(p.thread_id, {
          content: `👋 <@${target}> joined **${p.name}** (added by <@${u.id}>). Don't forget the in-game invite!`,
          allowed_mentions: { users: [target] },
        });
      }
      return { content: `✅ Added <@${target}> to **${p.name}**.` + note };
    }

    if (sub?.name === 'kick') {
      const target = String(opt('user') ?? '');
      const r = rankIn(p, target);
      if (!r) return { content: `<@${target}> is not in **${p.name}**.` };
      if (r === 'leader') return { content: 'The leader can\'t be removed. Close the party instead.' };
      if (r === 'officer' && !isLeader(p, i)) return { content: 'Only the leader can remove an officer.' };
      await supabase.from('party_members').delete().eq('party_id', p.id).eq('discord_id', target);
      return { content: `Removed <@${target}> from **${p.name}**.` + (await afterChange(supabase, p)) };
    }

    if (sub?.name === 'rank') {
      if (!isLeader(p, i)) return { content: 'Only the leader can change ranks (same as in game).' };
      const target = String(opt('user') ?? '');
      const r = rankIn(p, target);
      if (!r) return { content: `<@${target}> is not in **${p.name}**.` };
      if (r === 'leader') return { content: 'Leadership can\'t be handed over (same as in game).' };
      const rank = opt('rank') === 'officer' ? 'officer' : 'member';
      await supabase.from('party_members').update({ rank }).eq('party_id', p.id).eq('discord_id', target);
      return { content: `<@${target}> is now ${rank === 'officer' ? 'an ⭐ officer' : 'a member'} of **${p.name}**.` + (await afterChange(supabase, p)) };
    }

    if (sub?.name === 'league') {
      const league = await getLeague(supabase, String(opt('league') ?? ''));
      if (!league) return { content: 'Pick a league from the list (staff import them with `/league import`).' };
      const status = String(opt('status') ?? 'planning');
      if (status === 'drop') {
        await supabase.from('party_leagues').delete().eq('party_id', p.id).eq('league_id', league.id);
        return { content: `Dropped **${leagueLabel(league)}** from **${p.name}**.` + (await afterChange(supabase, p)) };
      }
      if (leagueState(league) === 'ended') return { content: 'That league has ended.' };
      const { error } = await supabase
        .from('party_leagues')
        .upsert({ party_id: p.id, league_id: league.id, status: status === 'joined' ? 'joined' : 'planning', updated_at: new Date().toISOString() });
      if (error) return { content: `❌ ${error.message}` };
      const warn = league.restriction ? `\n-# 🔒 ${league.restriction} league: only ${league.restriction} characters can join.` : '';
      const open = openSlots(p, league);
      return {
        content: `✅ **${p.name}** · ${leagueLabel(league)} · ${status === 'joined' ? 'joined (no more open slots shown)' : `planning${open ? `, ${open} open slot${open === 1 ? '' : 's'} on the board` : ''}`}.${warn}` + (await afterChange(supabase, p)),
      };
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

/** 🙋 Ask to join (button on the party card): pings leader + officers in the thread. */
export function handlePartyAsk(i: PartyInteraction) {
  const u = caller(i);
  if (!u) return ephemeral('Could not identify you.');
  const id = String(i.data.custom_id ?? '').slice(ASK_PREFIX.length);
  return deferred(i, async () => {
    const supabase = createAdminClient();
    const p = await getParty(supabase, id);
    if (!p || p.closed_at) return { content: 'This party is closed.' };
    if (rankIn(p, u.id)) return { content: 'You are already in this party.' };
    if (p.members.length >= PARTY_MAX) return { content: 'This party is full.' };
    if (!p.thread_id) return { content: 'This party has no thread.' };
    const staffIds = p.members.filter((m) => m.rank !== 'member').map((m) => m.discord_id);
    const info = (await discordInfo(supabase, [u.id])).get(u.id);
    const about = [info?.cl ? `CL ${info.cl}` : null, info?.tags.length ? info.tags.join('/') : null].filter(Boolean).join(' · ');
    const r = await postToChannelRich(p.thread_id, {
      content: `🙋 <@${u.id}>${about ? ` (${about})` : ''} would like to join **${p.name}**. ${staffIds.map((d) => `<@${d}>`).join(' ')}\n-# Leader/officers: \`/party invite user:\` after inviting them in game.`,
      allowed_mentions: { users: staffIds },
    });
    return { content: r.ok ? `✅ Asked in <#${p.thread_id}>. The leader will get back to you there.` : `❌ Could not post in the thread: ${r.error}` };
  });
}

// ─── /lfg ────────────────────────────────────────────────────────────────────

const LFG_PICK = 'party:lfg';

function skillPicker(selected: string[]) {
  const options = [SLAYER_SKILL, ...LEAGUE_SKILLS].map((s) => ({ label: s, value: s, default: selected.includes(s) }));
  return [{ type: 1, components: [{ type: 3, custom_id: LFG_PICK, placeholder: 'What are you looking for? (pick any)', min_values: 1, max_values: options.length, options }] }];
}

export function handleLfg(i: PartyInteraction) {
  const u = caller(i);
  if (!u) return ephemeral('Could not identify you.');
  const sub = subOf(i);
  const opt = optOf(sub);
  return deferred(i, async () => {
    const supabase = createAdminClient();
    if (sub?.name === 'clear') {
      await supabase.from('party_seekers').delete().eq('discord_id', u.id);
      await refreshPartyBoard(supabase);
      return { content: '✅ You are off the "looking for a party" list.' };
    }
    if (sub?.name === 'list') {
      const seekers = await activeSeekers(supabase);
      const info = await discordInfo(supabase, seekers.map((s) => s.discord_id));
      if (!seekers.length) return { content: 'Nobody is looking right now.' };
      return {
        content: seekers
          .map((s) => {
            const x = info.get(s.discord_id);
            return `<@${s.discord_id}>${x?.cl ? ` · CL ${x.cl}` : ''}${x?.tags.length ? ` · ${x.tags.join('/')}` : ''} · ${s.skills.join(', ') || 'anything'}${s.note ? ` · “${s.note}”` : ''}`;
          })
          .join('\n')
          .slice(0, 1990),
      };
    }
    // set: save the note now, skills come from the picker.
    const { data: existing } = await supabase.from('party_seekers').select('skills').eq('discord_id', u.id).maybeSingle();
    const note = opt('note');
    await supabase.from('party_seekers').upsert({
      discord_id: u.id,
      skills: (existing?.skills as string[] | undefined) ?? [],
      ...(note !== undefined ? { note: safe(String(note)).slice(0, 200) || null } : {}),
      expires_at: new Date(Date.now() + SEEKER_DAYS * 86400_000).toISOString(),
      updated_at: new Date().toISOString(),
    });
    return {
      content: `Pick what you're looking for. You stay listed on the 📋 Party board for ${SEEKER_DAYS} days (run \`/lfg set\` again to renew, \`/lfg clear\` when you found one).`,
      components: skillPicker((existing?.skills as string[] | undefined) ?? []),
    };
  });
}

export async function handleLfgPick(i: PartyInteraction) {
  const u = caller(i);
  if (!u) return ephemeral('Could not identify you.');
  const allowed = new Set<string>([SLAYER_SKILL, ...LEAGUE_SKILLS]);
  const skills = (i.data.values ?? []).filter((v) => allowed.has(v));
  const supabase = createAdminClient();
  const { error } = await supabase.from('party_seekers').upsert({
    discord_id: u.id,
    skills,
    expires_at: new Date(Date.now() + SEEKER_DAYS * 86400_000).toISOString(),
    updated_at: new Date().toISOString(),
  });
  waitUntil(refreshPartyBoard(supabase).catch(() => undefined));
  const until = Math.floor((Date.now() + SEEKER_DAYS * 86400_000) / 1000);
  return NextResponse.json({
    type: 7,
    data: {
      content: error ? `❌ ${error.message}` : `✅ Listed as looking for: **${skills.join(', ')}** until <t:${until}:D>. Leaders see you on the 📋 Party board.`,
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
  if (type === 4 && (name === 'party' || name === 'league')) return handlePartyAutocomplete(i);
  if (type === 2 && name === 'party') return handleParty(i);
  if (type === 2 && name === 'lfg') return handleLfg(i);
  if (type === 2 && name === 'league') return handleLeague(i);
  if (type === 3 && id.startsWith(ASK_PREFIX)) return handlePartyAsk(i);
  if (type === 3 && id === LFG_PICK) return handleLfgPick(i);
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
          { name: 'leader', type: 6, description: 'Staff: attach for someone else (default: you)', required: false },
        ],
      },
      { name: 'invite', type: 1, description: 'Add a member (leader/officers)', options: [{ name: 'user', type: 6, description: 'Discord member', required: true }, partyOpt] },
      { name: 'kick', type: 1, description: 'Remove a member (leader/officers)', options: [{ name: 'user', type: 6, description: 'Discord member', required: true }, partyOpt] },
      {
        name: 'league', type: 1, description: 'Plan a league, mark it joined, or drop it',
        options: [
          leagueOpt,
          { name: 'status', type: 3, description: 'planning = still recruiting · joined = registered in game', required: true, choices: [{ name: 'planning (show open slots)', value: 'planning' }, { name: 'joined in game', value: 'joined' }, { name: 'drop it', value: 'drop' }] },
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
      { name: 'rank', type: 1, description: 'Make someone officer or member (leader)', options: [{ name: 'user', type: 6, description: 'Discord member', required: true }, { name: 'rank', type: 3, description: 'Rank', required: true, choices: [{ name: 'officer', value: 'officer' }, { name: 'member', value: 'member' }] }, partyOpt] },
      { name: 'info', type: 1, description: 'Show a party', options: [partyOpt] },
      { name: 'leave', type: 1, description: 'Leave a party', options: [partyOpt] },
      { name: 'close', type: 1, description: 'Close the party (leader)', options: [partyOpt] },
      { name: 'verify', type: 1, description: 'Staff: mark / unmark as a verified Dream party', options: [partyOpt] },
    ],
  },
  {
    name: 'lfg',
    description: 'Looking for a league or Slayer party: list yourself on the 📋 Party board',
    options: [
      { name: 'set', type: 1, description: `List yourself for ${SEEKER_DAYS} days and pick skills`, options: [{ name: 'note', type: 3, description: 'e.g. "active daily, 2 alts"', required: false, max_length: 200 }] },
      { name: 'clear', type: 1, description: 'Remove yourself from the list' },
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
