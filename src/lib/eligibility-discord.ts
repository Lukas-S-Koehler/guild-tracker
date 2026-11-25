/**
 * /eligibility [ign] (docs/assault-roster.md §10): the same per-guild verdict as /assault/eligibility.
 *  - no ign: your claimed characters outside the assault guilds (highest CL first, up to 3)
 *  - ign: one of yours, or (deputies and up) anyone we know a game id for (staff lookup)
 * "Interested in joining" buttons (elig:<hashed>:<guild>) do the same as the page: Recruiting
 * prospect + a note in leadership-chat. Only the character's owner can press them.
 */
import { NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { createAdminClient } from '@/lib/supabase-server';
import { editOriginalInteractionResponse } from '@/lib/discord-api';
import { RANK, rankOfUser } from '@/lib/role-hierarchy';
import { TIERS, TRACKS } from '@/lib/roster-goals';
import {
  expressInterest, ownEligibility, staffLookup, 
  type EligibilityCharacter,
} from '@/lib/assault-eligibility';

interface EligibilityInteraction {
  token: string;
  application_id: string;
  member?: { user?: { id: string } };
  user?: { id: string };
  data: { custom_id?: string; options?: { name: string; value: string | number }[] };
}
const discordOf = (i: EligibilityInteraction) => i.member?.user?.id ?? i.user?.id ?? '';

async function userOfDiscord(discordId: string): Promise<string | null> {
  const { data } = await createAdminClient().from('user_discord_links').select('user_id').eq('discord_id', discordId).maybeSingle();
  return (data?.user_id as string | undefined) ?? null;
}

/**
 * One embed per character: the minimum (Bronze) as a checklist per assaulting guild, like the page.
 * Paused guilds aren't in `results` (loadRubrics), so normally this is one field.
 */
export function eligibilityEmbed(c: EligibilityCharacter) {
  const anyMeets = c.results.some((r) => r.verdict.meets);
  return {
    title: `${c.ign}: assault minimum`,
    description: `CL ${c.combat_level ?? '?'} ${c.character_class ?? ''} · ${c.guild_name ?? 'not in a Dream guild'}`,
    color: anyMeets ? 0x10b981 : 0xf59e0b,
    fields: c.results.map((r) => {
      const v = r.verdict;
      const g = r.guild.goals;
      const lines = [
        v.meets ? '✅ **Minimum reached**' : `**${checklistDone(r)} done**`,
        `-# at ${v.zone ?? 'its assault zone'}`,
        `${r.row.battle.gearSet ? '✅' : '⬜'} Gear saved`,
        `${r.row.pets_hidden ? '⬜' : '✅'} Pets visible`,
        ...TRACKS.filter((t) => t.importance !== 'bonus' && t.id !== 'potions').map((t) => {
          const tier = v.tiers[t.id];
          if (tier == null) return `⏳ ${t.label}: save gear first`;
          return tier >= 1 ? `✅ ${t.label} · ${TIERS[tier - 1]}` : `⬜ ${t.label}: needs ${t.tierText(0, g.tracks[t.id].thresholds, g)}`;
        }),
      ];
      if (!v.meets && v.moves.length) lines.push(`Next: ${v.moves.slice(0, 2).join(' · ')}`);
      return { name: r.guild.name, value: lines.join('\n').slice(0, 1024) };
    }),
    footer: { text: 'Minimum = Bronze on every line · pet hunt power = Citadel estimate' },
  };
}

function checklistDone(r: EligibilityCharacter['results'][number]): string {
  const counted = TRACKS.filter((t) => t.importance !== 'bonus' && t.id !== 'potions');
  const done = (r.row.battle.gearSet ? 1 : 0) + (r.row.pets_hidden ? 0 : 1) + counted.filter((t) => (r.verdict.tiers[t.id] ?? 0) >= 1).length;
  return `${done} of ${counted.length + 2}`;
}

/** "Interested in joining" buttons for guilds whose minimum this character meets (owner view only). */
function interestButtons(c: EligibilityCharacter, named: boolean) {
  const buttons = c.results
    .filter((r) => r.verdict.meets)
    .map((r) => ({
      type: 2,
      style: 1,
      label: `${named ? `${c.ign}: ` : ''}I'm interested in joining ${r.guild.nickname ?? r.guild.name}`.slice(0, 80),
      custom_id: `elig:${c.hashed_id}:${r.guild.id}`,
    }));
  return buttons.length ? [{ type: 1, components: buttons.slice(0, 5) }] : [];
}

/** /eligibility [ign]: deferred (reading from the game and building rows takes a few seconds). */
export function handleEligibilityCommand(i: EligibilityInteraction) {
  const raw = i.data.options?.find((o) => o.name === 'ign')?.value;
  const ign = typeof raw === 'string' ? raw.trim() : '';
  const discordId = discordOf(i);
  waitUntil(
    (async () => {
      const supabase = createAdminClient();
      let payload: Record<string, unknown>;
      try {
        const userId = await userOfDiscord(discordId);
        const own = userId ? await ownEligibility(userId, supabase, { budgetMs: 25_000 }) : null;
        const mine = (own?.characters ?? []).filter((c) => c.results.length);
        if (ign) {
          const c = mine.find((x) => x.ign.toLowerCase() === ign.toLowerCase());
          if (c) {
            payload = { embeds: [eligibilityEmbed(c)], components: interestButtons(c, false) };
          } else {
            // Not yours: staff lookup (deputies and up, like Recruiting).
            if (!userId || (await rankOfUser(supabase, userId)) < RANK.DEPUTY) {
              throw new Error(`${ign} isn't one of your characters outside the assault guilds. Staff can look up anyone.`);
            }
            const res = await staffLookup(ign, supabase);
            if (!res.ok) throw new Error(res.error);
            payload = { content: '-# Staff lookup', embeds: [eligibilityEmbed(res.character)] };
          }
        } else {
          if (!userId) throw new Error('Link your Discord to the site first: use `/claim`.');
          if (!mine.length) {
            throw new Error(
              own?.targets.length
                ? 'Your characters are still being read from the game. Try again in a minute.'
                : "No claimed characters outside the assault guilds. Characters in DE / DI are on `/roster`; claim others with `/claim`."
            );
          }
          const shown = mine.slice(0, 3);
          payload = {
            content: mine.length > shown.length ? `-# Also yours: ${mine.slice(3).map((c) => c.ign).join(', ')}. Use \`/eligibility ign:\`.` : undefined,
            embeds: shown.map(eligibilityEmbed),
            components: shown.flatMap((c) => interestButtons(c, shown.length > 1)).slice(0, 5),
          };
        }
      } catch (err) {
        payload = { content: err instanceof Error ? err.message : String(err) };
      }
      await editOriginalInteractionResponse(i.application_id, i.token, { allowed_mentions: { parse: [] }, ...payload });
    })()
  );
  return NextResponse.json({ type: 5, data: { flags: 64 } });
}

/** Button elig:<hashed>:<guild>: the owner says they're interested. Deferred: measuring takes a few seconds. */
export function handleEligibilityComponent(i: EligibilityInteraction) {
  const [, hashed, guildId] = String(i.data.custom_id ?? '').split(':');
  const discordId = discordOf(i);
  waitUntil(
    (async () => {
      let content: string;
      try {
        const userId = await userOfDiscord(discordId);
        if (!userId) throw new Error('Link your Discord to the site first: use `/claim`.');
        const res = await expressInterest(userId, hashed, guildId);
        if (!res.ok) throw new Error(res.error);
        content = res.posted
          ? "🙋 Noted! Staff know you're interested and will reach out in game. The guild move itself happens in game."
          : "You're already on the list for this guild. Staff will reach out in game.";
      } catch (err) {
        content = err instanceof Error ? err.message : String(err);
      }
      await editOriginalInteractionResponse(i.application_id, i.token, { content, allowed_mentions: { parse: [] } });
    })()
  );
  return NextResponse.json({ type: 5, data: { flags: 64 } });
}

export const ELIGIBILITY_COMMAND = {
  name: 'eligibility',
  description: 'Assault minimum checklist for your characters outside the assault guilds',
  options: [{ name: 'ign', type: 3, description: 'One of your characters (staff: anyone we know)', required: false }],
};
