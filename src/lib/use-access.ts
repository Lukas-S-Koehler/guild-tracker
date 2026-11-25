'use client';

/**
 * Who may see what (nav and page gates share this). Client-side only: APIs keep their own checks.
 *  - public:    anyone, signed out too
 *  - signedIn:  any account
 *  - member:    a character in a Dream guild (not the awaiting-assignment guest view)
 *  - assaulter: a character in an assault guild (DE / DI)
 * Super admin passes everything.
 */
import { useAuth } from '@/contexts/AuthContext';
import { ASSAULT_ENTRY_GUILD_ID, ASSAULT_TOP_GUILD_ID } from '@/lib/raids';

export type AccessLevel = 'public' | 'signedIn' | 'member' | 'assaulter';

const ASSAULT_GUILD_IDS = new Set([ASSAULT_ENTRY_GUILD_ID, ASSAULT_TOP_GUILD_ID]);

export function useAccess() {
  const { user, loading, isSuperAdmin, isAwaitingAssignment, guilds, myCharacters } = useAuth();
  const signedIn = !!user;
  const member = signedIn && (isSuperAdmin || (!isAwaitingAssignment && guilds.length > 0));
  const assaulter =
    signedIn &&
    (isSuperAdmin ||
      (!isAwaitingAssignment &&
        (myCharacters.some((c) => c.in_dream_guild && !!c.guild_id && ASSAULT_GUILD_IDS.has(c.guild_id)) ||
          guilds.some((g) => ASSAULT_GUILD_IDS.has(g.guild_id)))));
  const outsideDream = signedIn && !isSuperAdmin && !myCharacters.some((c) => c.in_dream_guild);
  const has = (level: AccessLevel) =>
    level === 'public' || (level === 'signedIn' ? signedIn : level === 'member' ? member : assaulter);
  return { loading, signedIn, member, assaulter, outsideDream, has };
}

/** Assault pages: rankings and eligibility are public, prep is for assaulters, the rest for Dream members. */
export function assaultPageLevel(pathname: string): AccessLevel {
  const p = pathname.replace(/\/$/, '');
  if (['/assault/leaderboard', '/assault/hall-of-fame', '/assault/eligibility'].some((x) => p === x || p.startsWith(x + '/'))) return 'public';
  if (['/assault/guide', '/assault/checklist', '/assault/potions', '/me/assault'].some((x) => p === x || p.startsWith(x + '/'))) return 'assaulter';
  return 'member';
}
