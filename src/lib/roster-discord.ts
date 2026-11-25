/**
 * Assault Roster on Discord (docs/assault-roster.md §7):
 *  - live board per assault guild (key assault-roster:<guildId>, edited in place): next wave RSVP,
 *    team goals, who still needs setup, RSVP buttons
 *  - /roster [ign] [guild]: guild summary, or one member's setup card
 */
import { NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase-server';
import { editOriginalInteractionResponse } from '@/lib/discord-api';
import { getLiveRow, publishLive, type LivePayload } from '@/lib/discord-live';
import { GUIDE_SITE_URL } from '@/lib/game-guide';
import { buildRoster, type Roster, type RosterRow } from '@/lib/assault-roster';
import { TIERS, TRACKS, evaluateGoals, meetsMinimum, mergeGoals, prerequisites, type GoalSet } from '@/lib/roster-goals';
import { fmtGold } from '@/lib/roster-moves';
import { rsvpComponents } from '@/lib/assault-rsvp';

export const ROSTER_PREFIX = 'assault-roster:';
export const rosterKey = (guildId: string) => `${ROSTER_PREFIX}${guildId}`;

const TIER_EMOJI = ['▫️', '🥉', '🥈', '🥇', '💎', '✨'];
const HIT_EMOJI = (h: number | null) => (h == null ? '⬛' : h <= 2 ? '🟩' : h === 3 ? '🟨' : h === 4 ? '🟧' : '🟥');
const SITE = GUIDE_SITE_URL;
const link = (label: string, path: string) => ({ type: 1, components: [{ type: 2, style: 5, label, url: `${SITE}${path}` }] });
const names = (rows: RosterRow[], max = 15) =>
  rows.length ? rows.slice(0, max).map((r) => r.ign).join(', ') + (rows.length > max ? ` +${rows.length - max}` : '') : '—';

async function goalsFor(supabase: SupabaseClient, guildId: string): Promise<GoalSet> {
  const { data } = await supabase.from('assault_roster_goals').select('goals').eq('guild_id', guildId).maybeSingle();
  return mergeGoals(data?.goals);
}

/** Guild summary embed (live board and /roster without an IGN). */
function summaryEmbed(roster: Roster, goals: GoalSet) {
  const active = roster.rows.filter((r) => r.participation !== 'none');
  const fields: { name: string; value: string; inline?: boolean }[] = [];

  if (roster.nextWave) {
    const by = (e: string) => active.filter((r) => r.rsvp.effective === e);
    const c = roster.nextWave.counts;
    fields.push({
      name: `📅 Next wave <t:${roster.nextWave.unix}:R>`,
      value: [
        `✅ **${c.in}** in · 🤔 ${c.maybe} maybe · ❌ ${c.out} out · ⏳ ${c.no_reply} no reply`,
        by('maybe').length ? `🤔 ${names(by('maybe'))}` : null,
        by('no_reply').length ? `⏳ Opt-in, no answer yet: ${names(by('no_reply'))}` : null,
      ].filter(Boolean).join('\n').slice(0, 1024),
    });
  }

  const evals = active.map((r) => ({ r, res: evaluateGoals(r, goals) }));
  const meets = evals.filter((e) => meetsMinimum(e.r, e.res)).length;
  const lines = TRACKS.map((t) => {
    const tiers = evals.map((e) => e.res.find((x) => x.id === t.id)!.tier);
    const bronze = tiers.filter((x) => x >= 1).length;
    const top = Math.max(0, ...tiers);
    return `${TIER_EMOJI[top]} **${t.label}** ${bronze}/${active.length} Bronze+`;
  });
  fields.push({ name: `🎯 Team goals · ${meets}/${active.length} meet the minimum`, value: lines.join('\n').slice(0, 1024) });

  const setup = active.filter((r) => prerequisites(r).some((p) => !p.ok));
  if (setup.length) {
    fields.push({
      name: `⚙️ Setup needed (${setup.length})`,
      value: `${names(setup, 20)}\n-# Gear on /combat, a default potion loadout, visible pets. Takes two minutes on the site.`.slice(0, 1024),
    });
  }

  const hunters = [...active].sort((a, b) => b.hunting.squadPower - a.hunting.squadPower).slice(0, 3);
  if (hunters.length) {
    fields.push({
      name: '🐾 Top pet hunt power',
      value: hunters.map((r, i) => `${['🥇', '🥈', '🥉'][i]} ${r.ign} · ${r.hunting.squadPower.toLocaleString()}`).join('\n'),
      inline: true,
    });
  }
  const dreams = active.filter((r) => r.battle.computed && r.battle.enemies.every((e) => (e.hits ?? 99) <= 2));
  if (dreams.length) fields.push({ name: '⚔️ All mobs in 2 hits', value: names(dreams, 12), inline: true });

  return {
    title: `🛡️ ${roster.guild.name} · assault roster`,
    url: `${SITE}/assault/roster`,
    description: `${active.length} assaulting · zone **${roster.zone.name ?? 'not set'}**. Tiers: 🥉 Bronze (minimum) · 🥈 Silver · 🥇 Gold · 💎 Crystal · ✨ Dream`,
    color: 0x5b8def,
    fields,
    footer: { text: 'Pet hunt power is a Citadel estimate · updated' },
    timestamp: new Date().toISOString(),
  };
}

/** Live board payload for one guild. */
export async function buildRosterBoard(supabase: SupabaseClient, guildId: string): Promise<LivePayload[]> {
  const roster = await buildRoster(guildId, supabase);
  if (!roster) return [];
  const goals = await goalsFor(supabase, guildId);
  return [{
    embeds: [summaryEmbed(roster, goals)],
    components: [link('Open the roster', '/assault/roster'), ...(roster.nextWave ? rsvpComponents(guildId, roster.nextWave.unix) : [])],
    allowed_mentions: { parse: [] },
  } as LivePayload];
}

export const rosterPayloadsFor = (supabase: SupabaseClient, key: string) => buildRosterBoard(supabase, key.slice(ROSTER_PREFIX.length));

/** Re-edit a guild's live board if it's bound (after an RSVP change). Fire and forget. */
export function refreshRosterBoardSoon(guildId: string) {
  waitUntil(
    (async () => {
      const supabase = createAdminClient();
      const key = rosterKey(guildId);
      if (!(await getLiveRow(supabase, key))) return;
      await publishLive(supabase, key, await buildRosterBoard(supabase, guildId), { mode: 'edit' });
    })().catch((e) => console.warn('[roster-board]', e))
  );
}

/** Member setup card for /roster ign:. */
function memberEmbed(r: RosterRow, roster: Roster, goals: GoalSet) {
  const results = evaluateGoals(r, goals);
  const b = r.battle;
  const hits = b.computed ? `${b.enemies.map((e) => HIT_EMOJI(e.hits)).join('')} ${b.dist.map((d) => `${d.count}×${d.hits}`).join(' · ')}` : 'set gear on /combat';
  const move = r.moves[0];
  const missing = prerequisites(r).filter((p) => !p.ok);
  return {
    title: `${r.ign} · CL ${r.combat_level ?? '?'} ${r.character_class ?? ''}`.trim(),
    url: `${SITE}/assault/roster`,
    thumbnail: r.image_url ? { url: r.image_url } : undefined,
    color: meetsMinimum(r, results) ? 0x22c55e : 0xef4444,
    description: missing.length
      ? `🔴 **Setup needed:** ${missing.map((p) => `${p.label} (${p.fix})`).join(' · ')}`
      : meetsMinimum(r, results)
        ? '🟢 Set up and eligible (meets the minimum)'
        : '🟠 Below the minimum on: ' + results.filter((x) => x.tier === 0 && TRACKS.find((t) => t.id === x.id)!.importance !== 'bonus').map((x) => TRACKS.find((t) => t.id === x.id)!.label).join(', '),
    fields: [
      {
        name: `⚔️ Battle · ${roster.zone.name ?? ''}`,
        value: [
          `Pet: ${b.bestPet ? `${b.bestPet.species} L${b.bestPet.level}` : '—'} · Potions: ${b.loadout ? (b.preset ? `${b.preset.label} preset` : 'custom') : 'not set'}`,
          `Hits: ${hits}${b.max2HitLevel && b.canScale && !b.scaleFixed ? ` · 2 hits to Lv ${b.max2HitLevel}` : ''}`,
        ].join('\n'),
      },
      {
        name: '🏹 Hunting',
        value: `Pet hunt power **${r.hunting.squadPower.toLocaleString()}** (best ${Math.min(20, r.hunting.eligibleCount)}/20 pets) · HM ${r.hunting_mastery ?? '?'} · Bow ${r.hunting.bow ? `${r.hunting.bow.name} +${r.hunting.bow.huntEff}%` : '—'}`,
      },
      {
        name: '🎯 Goals',
        value: results.map((x) => `${TIER_EMOJI[x.tier]} ${TRACKS.find((t) => t.id === x.id)!.label}`).join(' · ').slice(0, 1024),
      },
      ...(move
        ? [{ name: '➡️ Next best move', value: `${move.title}${move.cost != null ? ` · ${fmtGold(move.cost)}g${move.costNote ? ` (${move.costNote})` : ''}` : ''}${move.detail ? `\n-# ${move.detail}` : ''}`.slice(0, 1024) }]
        : []),
      ...(roster.nextWave && r.participation !== 'none'
        ? [{ name: '📅 Next wave', value: `<t:${roster.nextWave.unix}:R> · ${r.rsvp.effective === 'no_reply' ? 'no answer yet' : r.rsvp.effective}${!r.rsvp.answer && r.rsvp.effective === 'in' ? ' (auto)' : ''}` }]
        : []),
    ],
    footer: { text: `Tiers ${TIERS.map((t, i) => `${TIER_EMOJI[i + 1]} ${t}`).join(' ')}` },
  };
}

interface RosterInteraction {
  token: string;
  application_id: string;
  member?: { user?: { id: string } };
  user?: { id: string };
  data: { options?: { name: string; value: string | number }[] };
}

/** /roster [ign] [guild] — deferred (building the roster takes a few seconds). */
export function handleRosterCommand(i: RosterInteraction) {
  const opt = (n: string) => i.data.options?.find((o) => o.name === n)?.value;
  const ign = typeof opt('ign') === 'string' ? (opt('ign') as string).trim() : '';
  const wantGuild = typeof opt('guild') === 'string' ? (opt('guild') as string) : '';
  const discordId = i.member?.user?.id ?? i.user?.id ?? '';

  waitUntil(
    (async () => {
      const supabase = createAdminClient();
      let payload: Record<string, unknown>;
      try {
        let guildId = wantGuild;
        let target: { member_id: string; guild_id: string } | null = null;
        if (ign) {
          const { data } = await supabase.from('assault_roster').select('member_id, guild_id, ign').ilike('ign', ign).maybeSingle();
          if (!data) throw new Error(`${ign} isn't on an assault roster (DE / DI).`);
          target = data;
          guildId = data.guild_id;
        }
        if (!guildId) {
          // Default: the caller's assault guild (Discord mapping), else the first assault guild.
          const { data: mine } = await supabase.from('members').select('current_guild_id').eq('discord_id', discordId).eq('is_active', true);
          const { data: ag } = await supabase.from('guilds').select('id').eq('is_assault', true).order('name');
          const assault = (ag ?? []).map((g) => String(g.id));
          guildId = (mine ?? []).map((m) => String(m.current_guild_id)).find((g) => assault.includes(g)) ?? assault[0];
        }
        const roster = await buildRoster(guildId, supabase);
        if (!roster) throw new Error('Not an assault guild.');
        const goals = await goalsFor(supabase, guildId);
        if (target) {
          const row = roster.rows.find((r) => r.member_id === target!.member_id);
          if (!row) throw new Error('Not synced yet.');
          payload = { embeds: [memberEmbed(row, roster, goals)], components: [link('Open the roster', '/assault/roster')] };
        } else {
          payload = { embeds: [summaryEmbed(roster, goals)], components: [link('Open the roster', '/assault/roster')] };
        }
      } catch (err) {
        payload = { content: err instanceof Error ? err.message : String(err) };
      }
      await editOriginalInteractionResponse(i.application_id, i.token, { allowed_mentions: { parse: [] }, ...payload });
    })()
  );
  return NextResponse.json({ type: 5, data: { flags: 64 } });
}

/** IGN autocomplete: characters on the assault rosters. */
export async function handleRosterAutocomplete(i: { data: { options?: { name: string; value: string | number; focused?: boolean }[] } }) {
  const q = String(i.data.options?.find((o) => o.focused)?.value ?? '').trim();
  const supabase = createAdminClient();
  let query = supabase.from('assault_roster').select('ign').order('ign').limit(25);
  if (q) query = query.ilike('ign', `%${q}%`);
  const { data } = await query;
  return NextResponse.json({ type: 8, data: { choices: (data ?? []).map((r) => ({ name: r.ign, value: r.ign })) } });
}

export const ROSTER_COMMAND = {
  name: 'roster',
  description: "Assault roster: your guild's summary, or one member's setup (IGN)",
  options: [
    { name: 'ign', type: 3, description: 'Character on the DE / DI roster', required: false, autocomplete: true },
    {
      name: 'guild', type: 3, description: 'Assault guild (default: yours)', required: false,
      choices: [{ name: 'Dream Engineers (DE)', value: '1184' }, { name: 'Dream Invaders (DI)', value: '138' }],
    },
  ],
};
