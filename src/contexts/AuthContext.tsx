'use client';

import { createContext, useContext, useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase';

interface GuildMembership {
  guild_id: string;
  guild_name: string;
  role: 'MEMBER' | 'OFFICER' | 'DEPUTY' | 'LEADER';
  joined_at: string;
  is_active: boolean;
  is_assault?: boolean;
}

const SUPER_ADMIN_EMAIL = 'motivationluki@gmail.com';

const ROLE_PRIORITY: Record<string, number> = { LEADER: 3, DEPUTY: 2, OFFICER: 1, MEMBER: 0 };

function sortGuildsByRole(guilds: GuildMembership[]): GuildMembership[] {
  return [...guilds].sort((a, b) => (ROLE_PRIORITY[b.role] ?? 0) - (ROLE_PRIORITY[a.role] ?? 0));
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  guilds: GuildMembership[];
  currentGuild: GuildMembership | null;
  setCurrentGuild: (guild: GuildMembership | null) => void;
  isSuperAdmin: boolean;
  isGuest: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, displayName?: string) => Promise<{ error: Error | null; signedIn?: boolean }>;
  signOut: () => Promise<void>;
  hasRole: (requiredRole: 'MEMBER' | 'OFFICER' | 'DEPUTY' | 'LEADER') => boolean;
  isLeaderOf: (guildName: string) => boolean;
  /** Signed in, but no guild access yet (no approved character). Sees the guest view. */
  isAwaitingAssignment: boolean;
  /** The user's characters: approved claims + their alts. */
  myCharacters: AccountCharacter[];
  /** Guild ids any of the user's characters are currently in. */
  myGuildIds: Set<string>;
  refreshAccount: () => Promise<void>;
  /** Character the user is "playing as". Its guild is the current guild. */
  currentCharacter: AccountCharacter | null;
  setCurrentCharacter: (c: AccountCharacter) => void;
}

export interface AccountCharacter {
  member_id: string;
  ign: string;
  hashed_id: string | null;
  avatar_url: string | null;
  class: string | null;
  total_level: number | null;
  position: string | null;
  guild_id: string | null;
  guild_name: string | null;
  guild_nickname: string | null;
  in_dream_guild: boolean;
  claimed: boolean;
}

async function fetchGuestGuilds(): Promise<GuildMembership[]> {
  try {
    const res = await fetch('/api/guilds');
    if (!res.ok) return [];
    const allGuilds = await res.json();
    if (!Array.isArray(allGuilds)) return [];
    return allGuilds.map((g: any) => ({
      guild_id: g.id,
      guild_name: g.nickname || g.name,
      role: 'MEMBER' as const,
      joined_at: '',
      is_active: g.is_active ?? true,
    }));
  } catch {
    return [];
  }
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [guilds, setGuilds] = useState<GuildMembership[]>([]);
  const [currentGuild, setCurrentGuildState] = useState<GuildMembership | null>(null);
  const [loading, setLoading] = useState(true);
  const [isLoadingGuilds, setIsLoadingGuilds] = useState(false);
  const [isAwaitingAssignment, setIsAwaitingAssignment] = useState(false);
  const [myCharacters, setMyCharacters] = useState<AccountCharacter[]>([]);

  const loadAccount = useCallback(async () => {
    try {
      const res = await fetch('/api/account/characters', { cache: 'no-store' });
      if (!res.ok) return setMyCharacters([]);
      const data = await res.json();
      setMyCharacters(Array.isArray(data.characters) ? data.characters : []);
    } catch {
      setMyCharacters([]);
    }
  }, []);

  // Use ref instead of state to avoid closure issues in event handler
  const hasLoadedInitialGuilds = useRef(false);

  // Create Supabase client once, outside of useEffect
  const supabase = useMemo(() => createClient(), []);

  // Clear stale data ONLY ONCE on mount (not on every render)
  const [hasCheckedStaleData, setHasCheckedStaleData] = useState(false);

  useEffect(() => {
    if (hasCheckedStaleData) return;

    // Clear any stale session data
    const lastActivity = localStorage.getItem('lastActivity');
    const now = Date.now();
    const THIRTY_MINUTES = 30 * 60 * 1000;

    if (lastActivity && (now - parseInt(lastActivity)) > THIRTY_MINUTES) {
      console.log('[AuthContext] Clearing stale session data');
      localStorage.removeItem('currentGuildId');
      localStorage.clear();
    }

    // Update activity timestamp
    localStorage.setItem('lastActivity', now.toString());
    setHasCheckedStaleData(true);

    // Set up activity tracking (update every 5 minutes, not every minute)
    const activityInterval = setInterval(() => {
      localStorage.setItem('lastActivity', Date.now().toString());
    }, 300000); // Update every 5 minutes

    return () => clearInterval(activityInterval);
  }, [hasCheckedStaleData]);

  // Load user and their guilds on mount
  useEffect(() => {
    let mounted = true;
    let loadingGuildsRef = false; // Use ref to track loading state

    function applyGuilds(list: GuildMembership[], awaiting: boolean) {
      setGuilds(list);
      setIsAwaitingAssignment(awaiting);
      const savedGuildId = localStorage.getItem('currentGuildId');
      const savedGuild = list.find(g => g.guild_id === savedGuildId);
      setCurrentGuildState(savedGuild || list[0] || null);
    }

    // Signed-in user: real memberships, or the guest view while waiting for assignment.
    async function applyMemberships(data: GuildMembership[]) {
      const sorted = sortGuildsByRole(data);
      if (sorted.length > 0) {
        hasLoadedInitialGuilds.current = true;
        if (mounted) applyGuilds(sorted, false);
      } else {
        const guestGuilds = await fetchGuestGuilds();
        if (mounted) applyGuilds(guestGuilds, true);
      }
      loadAccount();
    }

    async function loadUser() {
      try {
        const { data: { user: currentUser } } = await supabase.auth.getUser();

        if (!mounted) return;
        setUser(currentUser);

        if (!currentUser) {
          // Guest mode — load guilds list so guests have a default guild
          const guestGuilds = await fetchGuestGuilds();
          if (mounted) applyGuilds(guestGuilds, false);
        }

        if (currentUser && !loadingGuildsRef) {
          loadingGuildsRef = true;
          setIsLoadingGuilds(true);

          try {
            console.log('[AuthContext] Fetching guilds for user:', currentUser.id);
            const res = await fetch('/api/auth/memberships');
            if (!mounted) return;
            const data: GuildMembership[] = res.ok ? await res.json() : [];
            await applyMemberships(data);
          } catch (fetchError) {
            console.error('[AuthContext] Error fetching guilds:', fetchError);
            if (mounted) setGuilds([]);
          } finally {
            setIsLoadingGuilds(false);
            loadingGuildsRef = false;
          }
        }
      } catch (error) {
        console.error('[AuthContext] Error loading user:', error);
        if (mounted) setGuilds([]);
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadUser();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('[AuthContext] Auth event:', event);

      // Ignore token refresh and user update events (they happen when tab regains focus)
      if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        console.log('[AuthContext] Ignoring', event, 'event');
        return;
      }

      // Ignore SIGNED_IN if we already have guilds loaded (initial load already handled)
      if (event === 'SIGNED_IN' && hasLoadedInitialGuilds.current) {
        console.log('[AuthContext] Ignoring SIGNED_IN - guilds already loaded');
        return;
      }

      // Only process specific events
      if (event === 'SIGNED_OUT') {
        console.log('[AuthContext] User signed out, clearing guilds');
        setUser(null);
        setGuilds([]);
        setCurrentGuildState(null);
        setIsAwaitingAssignment(false);
        setMyCharacters([]);
        localStorage.removeItem('currentGuildId');
      } else if (event === 'SIGNED_IN' && session?.user) {
        // ONLY process SIGNED_IN, not INITIAL_SESSION (already handled in loadUser)
        console.log('[AuthContext] User signed in, fetching guilds');
        setUser(session.user);

        // Fetch guilds when user signs in. Deferred out of the auth callback:
        // Supabase holds a lock while callbacks run, so awaiting a request here can race
        // the session cookie being written (the server then sees no session until refresh).
        if (!loadingGuildsRef && mounted) {
          loadingGuildsRef = true;
          setIsLoadingGuilds(true);
          setTimeout(async () => {
            try {
              console.log('[AuthContext] Fetching guilds for user:', session.user.id);
              const res = await fetch('/api/auth/memberships', { cache: 'no-store' });
              if (!mounted) return;
              const data: GuildMembership[] = res.ok ? await res.json() : [];
              await applyMemberships(data);
            } catch (fetchError) {
              console.error('[AuthContext] Error fetching guilds:', fetchError);
              if (mounted) setGuilds([]);
            } finally {
              setIsLoadingGuilds(false);
              loadingGuildsRef = false;
            }
          }, 0);
        }
      }
      // Ignore TOKEN_REFRESHED, USER_UPDATED, etc. to prevent loops
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [supabase]); // Only depend on supabase client

  const setCurrentGuild = (guild: GuildMembership | null) => {
    setCurrentGuildState(guild);
    if (guild) {
      localStorage.setItem('currentGuildId', guild.guild_id);
    } else {
      localStorage.removeItem('currentGuildId');
    }
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error as Error | null };
  };

  const signUp = async (email: string, password: string, displayName?: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          display_name: displayName || email.split('@')[0],
        }
      }
    });
    // session is set when email confirmation is off — the user is already signed in.
    return { error: error as Error | null, signedIn: !!data?.session };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setGuilds([]);
    setCurrentGuildState(null);
    setIsAwaitingAssignment(false);
    setMyCharacters([]);
    localStorage.removeItem('currentGuildId');
  };

  const hasRole = (requiredRole: 'MEMBER' | 'OFFICER' | 'DEPUTY' | 'LEADER') => {
    // Guests (and signed-in users awaiting assignment) have MEMBER-level read access only
    if (!user || isAwaitingAssignment) return requiredRole === 'MEMBER';
    if (!currentGuild) return false;

    const roleHierarchy = { MEMBER: 0, OFFICER: 1, DEPUTY: 2, LEADER: 3 };
    const userRoleLevel = roleHierarchy[currentGuild.role];
    const requiredRoleLevel = roleHierarchy[requiredRole];

    return userRoleLevel >= requiredRoleLevel;
  };

  const isLeaderOf = (guildName: string) => {
    return guilds.some(g => g.guild_name === guildName && g.role === 'LEADER');
  };

  const isSuperAdmin = user?.email === SUPER_ADMIN_EMAIL;
  const isGuest = !user;

  // ── Current character ──
  const [currentCharacterId, setCurrentCharacterId] = useState<string | null>(null);
  const usableCharacters = useMemo(
    () => myCharacters.filter((c) => c.in_dream_guild && c.guild_id && guilds.some((g) => g.guild_id === c.guild_id)),
    [myCharacters, guilds]
  );

  // Pick a sensible character once characters/guilds load (saved choice → one in current guild → claimed main).
  useEffect(() => {
    if (isAwaitingAssignment || usableCharacters.length === 0) {
      setCurrentCharacterId(null);
      return;
    }
    setCurrentCharacterId((cur) => {
      if (cur && usableCharacters.some((c) => c.member_id === cur)) return cur;
      const saved = typeof window !== 'undefined' ? localStorage.getItem('currentCharacterId') : null;
      const pick =
        usableCharacters.find((c) => c.member_id === saved) ??
        usableCharacters.find((c) => c.guild_id === currentGuild?.guild_id && c.claimed) ??
        usableCharacters.find((c) => c.guild_id === currentGuild?.guild_id) ??
        null;
      return pick?.member_id ?? null;
    });
  }, [usableCharacters, isAwaitingAssignment, currentGuild?.guild_id]);

  const currentCharacter = useMemo(() => {
    const c = usableCharacters.find((x) => x.member_id === currentCharacterId) ?? null;
    // Only "playing as" a character while its guild is the selected guild.
    return c && c.guild_id === currentGuild?.guild_id ? c : null;
  }, [usableCharacters, currentCharacterId, currentGuild?.guild_id]);

  const setCurrentCharacter = (c: AccountCharacter) => {
    setCurrentCharacterId(c.member_id);
    localStorage.setItem('currentCharacterId', c.member_id);
    const g = guilds.find((x) => x.guild_id === c.guild_id);
    if (g) setCurrentGuild(g);
  };
  const myGuildIds = useMemo(
    () => new Set(myCharacters.filter((c) => c.in_dream_guild && c.guild_id).map((c) => c.guild_id as string)),
    [myCharacters]
  );

  const value = {
    user,
    loading: loading || isLoadingGuilds,
    guilds,
    currentGuild,
    setCurrentGuild,
    isSuperAdmin,
    isGuest,
    signIn,
    signUp,
    signOut,
    hasRole,
    isLeaderOf,
    isAwaitingAssignment,
    myCharacters,
    myGuildIds,
    refreshAccount: loadAccount,
    currentCharacter,
    setCurrentCharacter,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
