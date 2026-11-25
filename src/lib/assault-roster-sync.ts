/**
 * Assault Roster snapshots (docs/assault-roster.md §3.1).
 *
 * One row in `assault_roster` per character currently in an assault guild (guilds.is_assault).
 * Each character costs 3 IdleMMO calls (information, effects, pets) and keys are limited to
 * ~20 requests/minute, so a run works stalest-attempt first inside a time budget and reports
 * how many are left; callers loop until `remaining` is 0.
 *
 * Key choice per character: the owner's key when the character's account is claimed on the
 * site (sees hidden pets), otherwise the super admin key (fetchCharacterSnapshot falls back
 * on its own when the owner's key is missing or rejected).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase-server';
import { getAllClaimLocks } from '@/lib/account-service';
import { fetchCharacterSnapshot, SUPER_ADMIN_USER_ID } from '@/lib/combat/profile-service';

export interface RosterSyncOptions {
  /** Stop starting new characters after this long (ms). Default 240 s (Vercel maxDuration 300). */
  budgetMs?: number;
  /** Only this assault guild. */
  guildId?: string;
  /** Only these members (still must be in an assault guild). */
  memberIds?: string[];
  /** Skip characters attempted more recently than this (ms). Default 20 h. */
  minAgeMs?: number;
}

export interface RosterSyncResult {
  synced: number;
  failed: { ign: string; error: string }[];
  /** Characters still due after this run (budget ran out). */
  remaining: number;
  /** Rows dropped because the character left the assault guilds. */
  removed: number;
}

interface AssaultMember {
  id: string;
  ign: string;
  hashed_id: string;
  current_guild_id: string;
}

export async function assaultGuildIds(supabase: SupabaseClient = createAdminClient()): Promise<string[]> {
  const { data } = await supabase.from('guilds').select('id').eq('is_assault', true);
  return (data ?? []).map((g) => String(g.id));
}

/** Active characters in assault guilds that have a hashed id (needed for the API). */
export async function assaultMembers(supabase: SupabaseClient = createAdminClient(), guildId?: string): Promise<AssaultMember[]> {
  const guilds = await assaultGuildIds(supabase);
  const ids = guildId ? guilds.filter((g) => g === guildId) : guilds;
  if (!ids.length) return [];
  const { data } = await supabase
    .from('members')
    .select('id, ign, hashed_id, current_guild_id')
    .in('current_guild_id', ids)
    .eq('is_active', true)
    .not('hashed_id', 'is', null);
  return (data ?? []) as AssaultMember[];
}

export async function syncAssaultRoster(opts: RosterSyncOptions = {}): Promise<RosterSyncResult> {
  const started = Date.now();
  const budgetMs = opts.budgetMs ?? 240_000;
  const minAgeMs = opts.minAgeMs ?? 20 * 60 * 60 * 1000;
  const supabase = createAdminClient();

  let members = await assaultMembers(supabase, opts.guildId);
  const result: RosterSyncResult = { synced: 0, failed: [], remaining: 0, removed: 0 };

  // Full runs drop characters that left the assault guilds.
  if (!opts.guildId && !opts.memberIds) {
    const keep = new Set(members.map((m) => m.id));
    const { data: rows } = await supabase.from('assault_roster').select('member_id');
    const stale = (rows ?? []).map((r) => r.member_id as string).filter((id) => !keep.has(id));
    if (stale.length) {
      await supabase.from('assault_roster').delete().in('member_id', stale);
      result.removed = stale.length;
    }
  }

  if (opts.memberIds) {
    const want = new Set(opts.memberIds);
    members = members.filter((m) => want.has(m.id));
  }
  if (!members.length) return result;

  const { data: existing } = await supabase
    .from('assault_roster')
    .select('member_id, last_attempt')
    .in('member_id', members.map((m) => m.id));
  const lastAttempt = new Map((existing ?? []).map((r) => [r.member_id as string, r.last_attempt as string | null]));

  const now = Date.now();
  const due = members
    .filter((m) => {
      const t = lastAttempt.get(m.id);
      return !t || now - new Date(t).getTime() >= minAgeMs;
    })
    .sort((a, b) => {
      const ta = lastAttempt.get(a.id) ? new Date(lastAttempt.get(a.id) as string).getTime() : 0;
      const tb = lastAttempt.get(b.id) ? new Date(lastAttempt.get(b.id) as string).getTime() : 0;
      return ta - tb;
    });

  // Owner per character (claims expanded over alt bundles); approved claims only.
  const locks = await getAllClaimLocks(supabase);
  const ownerOf = (memberId: string) => {
    const l = locks.get(memberId);
    return l && l.status === 'approved' ? l.user_id : null;
  };

  for (let i = 0; i < due.length; i++) {
    if (Date.now() - started > budgetMs) {
      result.remaining = due.length - i;
      break;
    }
    const m = due[i];
    const attemptAt = new Date().toISOString();
    try {
      const owner = ownerOf(m.id);
      const snap = await fetchCharacterSnapshot(owner ?? SUPER_ADMIN_USER_ID, m.hashed_id);
      const row = {
        member_id: m.id,
        guild_id: m.current_guild_id,
        hashed_id: m.hashed_id,
        ign: snap.ign ?? m.ign,
        character_class: snap.character_class,
        image_url: snap.image_url,
        stats: snap.stats,
        skills: snap.skills,
        equipped_pet: snap.equipped_pet,
        effects: snap.effects,
        location: snap.location,
        // Hidden pets: keep the last known list instead of wiping it.
        ...(snap.keep_stored_pets ? {} : { pets: snap.pets }),
        pets_hidden: snap.keep_stored_pets,
        // Unclaimed characters are read with the super admin key, which is never 'own'.
        key_source: owner && owner !== SUPER_ADMIN_USER_ID ? snap.key_source : 'shared',
        last_error: null,
        last_sync: attemptAt,
        last_attempt: attemptAt,
        updated_at: attemptAt,
      };
      const { error } = await supabase.from('assault_roster').upsert(row, { onConflict: 'member_id' });
      if (error) throw new Error(error.message);

      // Side benefit: members.combat_level is otherwise only filled via /me.
      const cl = (snap.skills as Record<string, { level?: number }> | undefined)?.combat?.level;
      if (typeof cl === 'number') await supabase.from('members').update({ combat_level: cl }).eq('id', m.id);
      result.synced++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.failed.push({ ign: m.ign, error: msg });
      // Record the attempt so one broken character doesn't block the queue every run.
      await supabase.from('assault_roster').upsert(
        {
          member_id: m.id,
          guild_id: m.current_guild_id,
          hashed_id: m.hashed_id,
          ign: m.ign,
          last_error: msg.slice(0, 300),
          last_attempt: attemptAt,
          updated_at: attemptAt,
        },
        { onConflict: 'member_id' }
      );
    }
  }
  return result;
}
