/**
 * Achievements on Discord (step 9, D3): the #hall-of-fame feed and the /me line.
 *  - One launch post after the silent backfill (rarest unlocks so far).
 *  - One digest per day: unlocks not yet announced, Silver and up, grouped by person.
 *    Bronze is site-only and gets marked announced without a post.
 * Unbound or paused feed = everything pending is marked announced, so nothing piles up.
 * Discord-facing text points to /me, not the website (Discord is core).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { ACHIEVEMENTS, ACHIEVEMENT_BY_KEY, TIERS, type Achievement } from '@/lib/achievements';
import { getAccountKeys } from '@/lib/alt-graph';
import { LAUNCH_POST_SETTING, setSetting } from '@/lib/achievement-eval';
import { getLiveRow, publishLive, textPayloads, type PublishResult } from '@/lib/discord-live';
import { HALL_OF_FAME_KEY } from '@/lib/live-messages';

const PAGE = 1000;
const tierRank = (a: Achievement) => TIERS[a.tier].rank;

interface Row { member_id: string; achievement_key: string; unlocked_at: string }
interface Person { ign: string; mention: string | null; title: string | null; achievements: Achievement[] }

async function unlockRows(supabase: SupabaseClient, filter: 'unannounced' | 'all'): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from('achievement_unlocks').select('member_id, achievement_key, unlocked_at').order('member_id').range(from, from + PAGE - 1);
    if (filter === 'unannounced') q = q.is('announced_at', null);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as Row[]));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

/** Group unlock rows into people (one per account): main IGN, Discord mention, chosen title. */
async function toPeople(supabase: SupabaseClient, rows: Row[]): Promise<Person[]> {
  const ids = Array.from(new Set(rows.map((r) => r.member_id)));
  if (!ids.length) return [];
  const keys = await getAccountKeys(supabase, ids);
  const all = Array.from(new Set(Array.from(keys.values()).concat(ids)));
  const [{ data: members }, { data: claims }] = await Promise.all([
    supabase.from('members').select('id, ign, discord_id, character_id, current_guild_id, is_active').in('id', ids),
    supabase.from('user_characters').select('user_id, member_id').eq('status', 'approved').in('member_id', all),
  ]);
  const userIds = Array.from(new Set((claims ?? []).map((c) => c.user_id as string)));
  const [{ data: titles }, { data: links }] = userIds.length
    ? await Promise.all([
        supabase.from('user_titles').select('user_id, achievement_key').in('user_id', userIds),
        supabase.from('user_discord_links').select('user_id, discord_id').in('user_id', userIds),
      ])
    : [{ data: [] }, { data: [] }];

  const byAccount = new Map<string, { members: NonNullable<typeof members>; keys: Set<string>; users: Set<string> }>();
  for (const m of members ?? []) {
    const k = keys.get(m.id) ?? m.id;
    const e = byAccount.get(k) ?? { members: [], keys: new Set<string>(), users: new Set<string>() };
    e.members.push(m);
    byAccount.set(k, e);
  }
  for (const r of rows) byAccount.get(keys.get(r.member_id) ?? r.member_id)?.keys.add(r.achievement_key);
  for (const c of claims ?? []) {
    const k = keys.get(c.member_id as string);
    if (k) byAccount.get(k)?.users.add(c.user_id as string);
  }

  const titleOf = new Map((titles ?? []).map((t) => [t.user_id as string, t.achievement_key as string]));
  const linkOf = new Map((links ?? []).map((l) => [l.user_id as string, l.discord_id as string]));
  return Array.from(byAccount.values()).map((e) => {
    const sorted = e.members.slice().sort((a, b) => (a.character_id ?? Infinity) - (b.character_id ?? Infinity));
    const main = sorted.find((m) => m.is_active !== false && m.current_guild_id) ?? sorted[0]!;
    const users = Array.from(e.users);
    const discord = users.map((u) => linkOf.get(u)).find(Boolean) ?? sorted.map((m) => m.discord_id).find(Boolean) ?? null;
    const titleKey = users.map((u) => titleOf.get(u)).find(Boolean);
    return {
      ign: main.ign,
      mention: discord ? `<@${discord}>` : null,
      title: titleKey ? ACHIEVEMENT_BY_KEY.get(titleKey)?.name ?? null : null,
      achievements: Array.from(e.keys).map((k) => ACHIEVEMENT_BY_KEY.get(k)).filter(Boolean).sort((a, b) => tierRank(b!) - tierRank(a!)) as Achievement[],
    };
  });
}

const personHead = (p: Person) => `**${p.ign}**${p.mention ? ` ${p.mention}` : ''}${p.title ? ` · *${p.title}*` : ''}`;
const badge = (a: Achievement) => `${TIERS[a.tier].emoji} ${a.name}`;

export async function buildLaunchPost(supabase: SupabaseClient): Promise<string[]> {
  const rows = await unlockRows(supabase, 'all');
  const people = await toPeople(supabase, rows);
  const rare = people
    .map((p) => ({ ...p, achievements: p.achievements.filter((a) => tierRank(a) >= TIERS.crystal.rank) }))
    .filter((p) => p.achievements.length)
    .sort((a, b) => b.achievements.reduce((s, x) => s + TIERS[x.tier].xp, 0) - a.achievements.reduce((s, x) => s + TIERS[x.tier].xp, 0))
    .slice(0, 12);
  const total = people.reduce((s, p) => s + p.achievements.length, 0);
  return [
    '# 🏆 Achievements are live',
    `Every Dream member now earns achievements for donating, raiding, streaks, guild challenges, assaults, bumps and more: **${ACHIEVEMENTS.length}** in total, from 🥉 Bronze to 🌌 Dream. Your alts count together as one account.`,
    'Type **/me** to see yours. Gold and higher unlock a **title** you can show off. From now on, new 🥈 Silver+ unlocks are posted here once a day.',
    '',
    '### 🌌 Rarest so far',
    ...rare.map((p) => `${personHead(p)}\n-# ${p.achievements.map(badge).join(' · ')}`),
    '',
    `-# ${people.length} players already hold ${total.toLocaleString('en-US')} achievements from the last months.`,
  ];
}

export function buildDigest(people: Person[], day: string): string[] {
  const sorted = people.slice().sort((a, b) => tierRank(b.achievements[0]!) - tierRank(a.achievements[0]!) || a.ign.localeCompare(b.ign));
  return [
    `## 🏆 Hall of Fame · ${day}`,
    ...sorted.map((p) => `${personHead(p)}\n${p.achievements.map(badge).join(' · ')}`),
  ];
}

export interface FeedResult {
  launch?: PublishResult | 'skipped';
  digest?: PublishResult | 'nothing' | 'unbound';
  announced: number;
}

/** Launch post (once) + today's digest. Call after runAchievements. */
export async function postHallOfFame(supabase: SupabaseClient, day: string): Promise<FeedResult> {
  const row = await getLiveRow(supabase, HALL_OF_FAME_KEY);
  const live = !!row?.enabled;
  const out: FeedResult = { announced: 0 };

  if (live) {
    const { data } = await supabase.from('app_settings').select('value').eq('key', LAUNCH_POST_SETTING).maybeSingle();
    if (!data?.value) {
      out.launch = await publishLive(supabase, HALL_OF_FAME_KEY, textPayloads(await buildLaunchPost(supabase)), { mode: 'append', force: true });
      if (out.launch.ok) await setSetting(supabase, LAUNCH_POST_SETTING, new Date().toISOString());
    } else out.launch = 'skipped';
  }

  const pending = await unlockRows(supabase, 'unannounced');
  if (!pending.length) {
    out.digest = 'nothing';
    return out;
  }
  const show = pending.filter((r) => {
    const a = ACHIEVEMENT_BY_KEY.get(r.achievement_key);
    return a && tierRank(a) >= TIERS.silver.rank;
  });

  if (live && show.length) {
    const people = await toPeople(supabase, show);
    out.digest = await publishLive(supabase, HALL_OF_FAME_KEY, textPayloads(buildDigest(people, day)), { mode: 'append', force: true });
    if (!out.digest.ok) return out; // retry tomorrow
  } else out.digest = live ? 'nothing' : 'unbound';

  const now = new Date().toISOString();
  const ids = Array.from(new Set(pending.map((r) => r.member_id)));
  for (let i = 0; i < ids.length; i += 200) {
    await supabase.from('achievement_unlocks').update({ announced_at: now }).in('member_id', ids.slice(i, i + 200)).is('announced_at', null);
  }
  out.announced = pending.length;
  return out;
}

/** Short line for the Discord /me embed. Reads stored unlocks only (cheap). */
export async function achievementsField(supabase: SupabaseClient, memberIds: string[], userId: string) {
  const [{ data: rows }, { data: title }] = await Promise.all([
    supabase.from('achievement_unlocks').select('achievement_key, unlocked_at').in('member_id', memberIds),
    supabase.from('user_titles').select('achievement_key').eq('user_id', userId).maybeSingle(),
  ]);
  const latest = new Map<string, string>();
  for (const r of rows ?? []) {
    const p = latest.get(r.achievement_key);
    if (!p || r.unlocked_at < p) latest.set(r.achievement_key, r.unlocked_at);
  }
  if (!latest.size) return null;
  const got = Array.from(latest.entries())
    .map(([k, at]) => ({ a: ACHIEVEMENT_BY_KEY.get(k), at }))
    .filter((x) => x.a) as Array<{ a: Achievement; at: string }>;
  const xp = got.reduce((s, x) => s + TIERS[x.a.tier].xp, 0);
  const recent = got.sort((x, y) => (x.at < y.at ? 1 : -1)).slice(0, 3).map((x) => badge(x.a)).join(' · ');
  const t = title?.achievement_key ? ACHIEVEMENT_BY_KEY.get(title.achievement_key as string)?.name : null;
  return {
    name: `🏅 Achievements · ${got.length}/${ACHIEVEMENTS.length} · ${xp} XP`,
    value: `${t ? `Title: *${t}*\n` : ''}Latest: ${recent}`,
    title: t ?? null,
  };
}
