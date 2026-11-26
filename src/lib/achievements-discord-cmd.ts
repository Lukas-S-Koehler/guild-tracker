/**
 * Discord /achievements (Dream Hub F9): one account's achievements, browsable by category.
 *  - No category: overview (per-category progress, closest to unlock, latest unlocks, rank, title).
 *  - Category: every achievement in it, unlocked with date or locked with progress.
 * A select menu (custom_id `hubach:<ign>`) switches category in place. Reply is private with a
 * 📢 Share button (card `achievements`, arg `<ign>|<category>`).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { accountProgress, type AchievementView } from '@/lib/achievement-eval';
import { CATEGORIES, TIERS, type Category } from '@/lib/achievements';
import { findProfileAccount } from '@/lib/profile';
import { profilePath } from '@/lib/profile-path';
import { GUIDE_SITE_URL } from '@/lib/game-guide';

export const ACH_SELECT_PREFIX = 'hubach:';
const OVERVIEW = 'overview';
const CRYSTAL = 0x4cc9f0;

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const short = (n: number) => (n >= 1e6 ? `${+(n / 1e6).toFixed(2)}M` : n >= 1e4 ? `${+(n / 1e3).toFixed(1)}k` : fmt(n));
const bar = (value: number, max: number, width = 8) => {
  const n = max > 0 ? Math.round(Math.min(1, value / max) * width) : 0;
  return '▰'.repeat(n) + '▱'.repeat(width - n);
};
const day = (iso: string) => `<t:${Math.floor(Date.parse(iso) / 1000)}:d>`;
const badge = (a: AchievementView) => `${TIERS[a.tier].emoji} ${a.name}`;

export function isCategory(v: string): v is Category {
  return v in CATEGORIES;
}

export const CATEGORY_CHOICES = (Object.keys(CATEGORIES) as Category[]).map((c) => ({ name: CATEGORIES[c], value: c }));

function categorySelect(ign: string, current: string) {
  const options = [
    { label: 'Overview', value: OVERVIEW, emoji: { name: '🏅' }, default: current === OVERVIEW },
    ...(Object.keys(CATEGORIES) as Category[]).map((c) => ({ label: CATEGORIES[c], value: c, default: current === c })),
  ];
  return {
    type: 1,
    components: [{ type: 3, custom_id: `${ACH_SELECT_PREFIX}${ign}`.slice(0, 100), placeholder: 'Pick a category', options }],
  };
}

function line(a: AchievementView): string {
  if (a.unlocked_at) return `✅ ${badge(a)} · ${a.description} · ${day(a.unlocked_at)}`;
  if (a.hidden) return `🔒 ${TIERS[a.tier].emoji} ??? · hidden`;
  const progress = a.threshold > 1 ? ` · ${bar(a.value, a.threshold)} ${short(a.value)} / ${short(a.threshold)}` : '';
  return `▫️ ${badge(a)} · ${a.description}${progress}`;
}

/** Embed + select menu for an account. `category` = a Category or 'overview'. */
export async function achievementsPayload(supabase: SupabaseClient, ign: string, category = OVERVIEW): Promise<{ payload: Record<string, unknown> }> {
  const account = await findProfileAccount(ign, supabase);
  if (!account) return { payload: { content: `No Dream character called **${ign}**.` } };
  const p = await accountProgress(supabase, account.characters.map((c) => c.member_id), account.userId);
  const url = `${GUIDE_SITE_URL}${profilePath(ign)}`;
  const head = [
    `**${p.unlocked}/${p.total}** unlocked · ${fmt(p.xp)} Dream XP`,
    `${p.rank ? `${p.rank.emoji} **${p.rank.name}**` : 'No rank yet'}${p.next_rank ? ` · ${fmt(p.next_rank.min - p.xp)} to ${p.next_rank.emoji} ${p.next_rank.name}` : ''}`,
    ...(p.title ? [`Title: *${p.title.name}*`] : []),
  ];

  let embed: Record<string, unknown>;
  if (isCategory(category)) {
    const list = p.achievements.filter((a) => a.category === category);
    const got = list.filter((a) => a.unlocked_at).length;
    embed = {
      title: `🏅 ${CATEGORIES[category]} · ${ign}`,
      url,
      color: CRYSTAL,
      description: [`**${got}/${list.length}** in this category`, '', ...list.map(line)].join('\n').slice(0, 4000),
      footer: { text: 'Alts count as one account · progress updates daily after the activity check' },
    };
  } else {
    const perCat = (Object.keys(CATEGORIES) as Category[])
      .map((c) => {
        const list = p.achievements.filter((a) => a.category === c);
        const got = list.filter((a) => a.unlocked_at).length;
        return list.length ? `${bar(got, list.length, 6)} ${CATEGORIES[c]} **${got}/${list.length}**` : null;
      })
      .filter(Boolean);
    const closest = p.achievements
      .filter((a) => !a.unlocked_at && !a.hidden && a.threshold > 1 && a.value > 0)
      .sort((a, b) => b.value / b.threshold - a.value / a.threshold)
      .slice(0, 5)
      .map((a) => `${badge(a)} · ${bar(a.value, a.threshold)} ${short(a.value)} / ${short(a.threshold)}`);
    const latest = p.achievements
      .filter((a) => a.unlocked_at)
      .sort((a, b) => (a.unlocked_at! < b.unlocked_at! ? 1 : -1))
      .slice(0, 5)
      .map((a) => `${badge(a)} · ${day(a.unlocked_at!)}`);
    const tiers = (Object.keys(TIERS) as Array<keyof typeof TIERS>)
      .map((t) => `${TIERS[t].emoji} ${p.achievements.filter((a) => a.tier === t && a.unlocked_at).length}`)
      .join('  ');
    embed = {
      title: `🏅 Achievements · ${ign}`,
      url,
      color: CRYSTAL,
      description: [...head, tiers].join('\n'),
      fields: [
        { name: 'Categories', value: perCat.join('\n').slice(0, 1024) || '—', inline: false },
        ...(closest.length ? [{ name: '🎯 Closest to unlock', value: closest.join('\n').slice(0, 1024), inline: false }] : []),
        ...(latest.length ? [{ name: '🆕 Latest', value: latest.join('\n').slice(0, 1024), inline: false }] : []),
      ],
      footer: { text: 'Pick a category below for the full list · Gold+ unlocks a title (pick it on the website /me)' },
    };
  }

  return {
    payload: {
      embeds: [embed],
      components: [categorySelect(ign, isCategory(category) ? category : OVERVIEW), { type: 1, components: [{ type: 2, style: 5, label: 'Open profile', url }] }],
    },
  };
}
