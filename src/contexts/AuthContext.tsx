'use client';

import { createContext, useContext, useEffect, useState, useMemo, useRef } from 'react';
import { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase';

interface GuildMembership {
  guild_id: string;
  guild_name: string;
  role: 'MEMBER' | 'OFFICER' | 'DEPUTY' | 'LEADER';
  joined_at: string;
  is_active: boolean;
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
  signUp: (email: string, password: string, displayName?: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  hasRole: (requiredRole: 'MEMBER' | 'OFFICER' | 'DEPUTY' | 'LEADER') => boolean;
  isLeaderOf: (guildName: string) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [guilds, setGuilds] = useState<GuildMembership[]>([]);
  const [currentGuild, setCurrentGuildState] = useState<GuildMembership | null>(null);
  const [loading, setLoading] = useState(true);
  const [isLoadingGuilds, setIsLoadingGuilds] = useState(false);

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

    async function loadUser() {
      try {
        const { data: { user: currentUser } } = await supabase.auth.getUser();

        if (!mounted) return;
        setUser(currentUser);

        if (!currentUser) {
          // Guest mode — load guilds list so guests have a default guild
          try {
            const res = await fetch('/api/guilds');
            if (res.ok) {
              const allGuilds = await res.json();
              if (mounted && Array.isArray(allGuilds) && allGuilds.length > 0) {
                const guestGuilds: GuildMembership[] = allGuilds.map((g: any) => ({
                  guild_id: g.id,
                  guild_name: g.nickname || g.name,
                  role: 'MEMBER' as const,
                  joined_at: '',
                  is_active: g.is_active ?? true,
                }));
                setGuilds(guestGuilds);
                const savedGuildId = localStorage.getItem('currentGuildId');
                const savedGuild = guestGuilds.find(g => g.guild_id === savedGuildId);
                setCurrentGuildState(savedGuild || guestGuilds[0]);
              }
            }
          } catch {
            // ignore — guest with no guild context
          }
        }

        if (currentUser && !loadingGuildsRef) {
          loadingGuildsRef = true;
          setIsLoadingGuilds(true);

          try {
            console.log('[AuthContext] Fetching guilds for user:', currentUser.id);
            const res = await fetch('/api/auth/memberships');
            if (!mounted) return;
            const data: GuildMembership[] = res.ok ? await res.json() : [];
            const sorted = sortGuildsByRole(data);
            setGuilds(sorted);
            if (sorted.length > 0) {
              hasLoadedInitialGuilds.current = true;
              const savedGuildId = localStorage.getItem('currentGuildId');
              const savedGuild = sorted.find(g => g.guild_id === savedGuildId);
              setCurrentGuildState(savedGuild || sorted[0]);
            } else {
              setCurrentGuildState(null);
            }
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
        localStorage.removeItem('currentGuildId');
      } else if (event === 'SIGNED_IN' && session?.user) {
        // ONLY process SIGNED_IN, not INITIAL_SESSION (already handled in loadUser)
        console.log('[AuthContext] User signed in, fetching guilds');
        setUser(session.user);

        // Fetch guilds when user signs in
        if (!loadingGuildsRef && mounted) {
          loadingGuildsRef = true;
          setIsLoadingGuilds(true);

          try {
            console.log('[AuthContext] Fetching guilds for user:', session.user.id);
            const res = await fetch('/api/auth/memberships');
            if (!mounted) return;
            const data: GuildMembership[] = res.ok ? await res.json() : [];
            const sorted = sortGuildsByRole(data);
            setGuilds(sorted);
            if (sorted.length > 0) {
              hasLoadedInitialGuilds.current = true;
              const savedGuildId = localStorage.getItem('currentGuildId');
              const savedGuild = sorted.find(g => g.guild_id === savedGuildId);
              setCurrentGuildState(savedGuild || sorted[0]);
            } else {
              setCurrentGuildState(null);
            }
          } catch (fetchError) {
            console.error('[AuthContext] Error fetching guilds:', fetchError);
            if (mounted) setGuilds([]);
          } finally {
            setIsLoadingGuilds(false);
            loadingGuildsRef = false;
          }
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
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          display_name: displayName || email.split('@')[0],
        }
      }
    });
    return { error: error as Error | null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setGuilds([]);
    setCurrentGuildState(null);
    localStorage.removeItem('currentGuildId');
  };

  const hasRole = (requiredRole: 'MEMBER' | 'OFFICER' | 'DEPUTY' | 'LEADER') => {
    // Guests have MEMBER-level read access only
    if (!user) return requiredRole === 'MEMBER';
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
