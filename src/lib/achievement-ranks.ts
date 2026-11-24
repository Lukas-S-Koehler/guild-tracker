/**
 * Rank ladder (Dream Hub step 11, D4; re-based in step 15). Dream XP = lifetime Dream Pass XP: every
 * season's XP added up (activity, assaults, community, chat and achievement unlocks), read from
 * `dream_pass_scores` (src/lib/dream-pass-eval.ts → lifetimeXpByMember).
 * A person holds exactly one rank role on Discord: the highest rank reached.
 *
 * Role ids are created by DreamBot (Admin → Discord → Role sync → Achievement ranks) and stored in
 * app_settings[RANK_ROLES_SETTING] as { [rankKey]: roleId }. Nothing is synced until they exist.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { ACHIEVEMENT_BY_KEY, TIERS } from '@/lib/achievements';

export interface Rank {
  key: string;
  name: string;
  /** Dream XP needed. */
  min: number;
  /** Discord role colour (int). */
  color: number;
  emoji: string;
}

/**
 * Lowest first. Sized on the 2026-11-24 dry run of lifetime Dream XP (220 accounts with XP): p50 450 ·
 * p75 1,786 · p90 3,606 · max 12,086. Holders at launch: 122 / 68 / 33 / 12 / 0. Dream Weaver is out of
 * reach at launch on purpose (a regular assaulter earns ~1k a month). Old ladder (achievements only) was
 * 100/300/600/1000/1500.
 */
export const RANKS: Rank[] = [
  { key: 'dreamer', name: 'Dreamer', min: 300, color: 0x9ca3af, emoji: '💤' },
  { key: 'lucid', name: 'Lucid', min: 1250, color: 0x60a5fa, emoji: '🌙' },
  { key: 'visionary', name: 'Visionary', min: 3000, color: 0xa78bfa, emoji: '🔮' },
  { key: 'crystal_mind', name: 'Crystal Mind', min: 6000, color: 0x22d3ee, emoji: '💎' },
  { key: 'dream_weaver', name: 'Dream Weaver', min: 15000, color: 0xf0abfc, emoji: '🌌' },
];

export const RANK_ROLES_SETTING = 'achievement_rank_roles';

export function rankFor(xp: number): Rank | null {
  let out: Rank | null = null;
  for (const r of RANKS) if (xp >= r.min) out = r;
  return out;
}

export function nextRank(xp: number): Rank | null {
  return RANKS.find((r) => xp < r.min) ?? null;
}

export const xpOf = (keys: Set<string> | string[]) => {
  let xp = 0;
  keys.forEach((k) => {
    const a = ACHIEVEMENT_BY_KEY.get(k);
    if (a) xp += TIERS[a.tier].xp;
  });
  return xp;
};

/** { rankKey: roleId } for ranks whose Discord role exists. */
export async function loadRankRoles(supabase: SupabaseClient): Promise<Record<string, string>> {
  const { data } = await supabase.from('app_settings').select('value').eq('key', RANK_ROLES_SETTING).maybeSingle();
  if (!data?.value) return {};
  try {
    const parsed = JSON.parse(data.value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export async function saveRankRoles(supabase: SupabaseClient, roles: Record<string, string>) {
  const { error } = await supabase.from('app_settings').upsert({ key: RANK_ROLES_SETTING, value: JSON.stringify(roles) });
  if (error) throw new Error(error.message);
}

/**
 * Dream XP per member id (account-pooled: the evaluator writes every unlock to every character of
 * the account, so the union over a person's characters is their account total).
 */
export async function unlockKeysByMember(supabase: SupabaseClient, memberIds?: string[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  const chunks = memberIds ? Array.from({ length: Math.ceil(memberIds.length / 200) }, (_, i) => memberIds.slice(i * 200, i * 200 + 200)) : [null];
  for (const chunk of chunks) {
    if (chunk && !chunk.length) continue;
    for (let from = 0; ; from += 1000) {
      let q = supabase.from('achievement_unlocks').select('member_id, achievement_key').order('member_id').order('achievement_key').range(from, from + 999);
      if (chunk) q = q.in('member_id', chunk);
      const { data, error } = await q;
      if (error) {
        // Migration not run: behave as "no achievements" rather than breaking role sync.
        if (/achievement_unlocks/.test(error.message)) return out;
        throw new Error(error.message);
      }
      for (const r of data ?? []) {
        const s = out.get(r.member_id) ?? new Set<string>();
        s.add(r.achievement_key);
        out.set(r.member_id, s);
      }
      if (!data || data.length < 1000) break;
    }
  }
  return out;
}
