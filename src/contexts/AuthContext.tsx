'use client';

import { createContext, useContext, useEffect, useState, useMemo } from 'react';
import { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase';

interface GuildMembership {
  guild_id: string;
  guild_name: string;
  role: 'MEMBER' | 'OFFICER' | 'DEPUTY' | 'LEADER';
  joined_at: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  guilds: GuildMembership[];
  currentGuild: GuildMembership | null;
  setCurrentGuild: (guild: GuildMembership | null) => void;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, displayName?: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  hasRole: (requiredRole: 'MEMBER' | 'OFFICER' | 'DEPUTY' | 'LEADER') => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [guilds, setGuilds] = useState<GuildMembership[]>([]);
  const [currentGuild, setCurrentGuildState] = useState<GuildMembership | null>(null);
  const [loading, setLoading] = useState(true);
  const [isLoadingGuilds, setIsLoadingGuilds] = useState(false);

  // Create Supabase client once, outside of useEffect
  const supabase = useMemo(() => createClient(), []);

  // Clear stale data on mount
  useEffect(() => {
    // Clear any stale session data
    const lastActivity = localStorage.getItem('lastActivity');
    const now = Date.now();
    const THIRTY_MINUTES = 30 * 60 * 1000;

    if (lastActivity && (now - parseInt(lastActivity)) > THIRTY_MINUTES) {
      console.log('[AuthContext] Clearing stale session data');
      localStorage.removeItem('currentGuildId');
      // Force a fresh session check
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (!session) {
          console.log('[AuthContext] No valid session found, clearing');
          localStorage.clear();
        }
      });
    }

    // Update activity timestamp
    localStorage.setItem('lastActivity', now.toString());

    // Set up activity tracking
    const activityInterval = setInterval(() => {
      localStorage.setItem('lastActivity', Date.now().toString());
    }, 60000); // Update every minute

    return () => clearInterval(activityInterval);
  }, [supabase]);

  // Load user and their guilds on mount
  useEffect(() => {
    let mounted = true;
    let loadingGuildsRef = false; // Use ref to track loading state

    async function loadUser() {
      try {
        const { data: { user: currentUser } } = await supabase.auth.getUser();

        if (!mounted) return;
        setUser(currentUser);

        if (currentUser && !loadingGuildsRef) {
          loadingGuildsRef = true;
          setIsLoadingGuilds(true);

          try {
            // Fetch user's guilds directly (more reliable than RPC)
            console.log('[AuthContext] Fetching guilds for user:', currentUser.id);

            const { data: userGuilds, error } = await supabase
              .from('guild_members')
              .select(`
                guild_id,
                role,
                joined_at,
                guilds!inner (
                  name
                )
              `)
              .eq('user_id', currentUser.id)
              .order('joined_at', { ascending: true });

            console.log('[AuthContext] Query result:', { userGuilds, error });

            if (!mounted) return;

            if (error) {
              console.error('[AuthContext] Error fetching guilds:', error);
              console.error('[AuthContext] Error details:', {
                message: error.message,
                code: error.code,
                details: error.details,
                hint: error.hint
              });
              setGuilds([]);
            } else if (userGuilds && Array.isArray(userGuilds) && userGuilds.length > 0) {
              console.log('[AuthContext] Found guilds:', userGuilds);

              // Transform the data to match GuildMembership interface
              const transformedGuilds: GuildMembership[] = userGuilds.map((g: any) => ({
                guild_id: g.guild_id,
                guild_name: g.guilds.name,
                role: g.role as 'MEMBER' | 'OFFICER' | 'DEPUTY' | 'LEADER',
                joined_at: g.joined_at,
              }));

              setGuilds(transformedGuilds);

              // Try to restore current guild from localStorage
              const savedGuildId = localStorage.getItem('currentGuildId');
              const savedGuild = transformedGuilds.find((g) => g.guild_id === savedGuildId);

              // Set current guild to saved guild or first available guild
              setCurrentGuildState(savedGuild || transformedGuilds[0]);
            } else {
              console.log('[AuthContext] No guilds found for user');
              // No guilds found
              setGuilds([]);
              setCurrentGuildState(null);
            }
          } catch (fetchError) {
            console.error('[AuthContext] Error fetching guilds:', fetchError);
            if (mounted) setGuilds([]);
          } finally {
            if (mounted) {
              setIsLoadingGuilds(false);
              loadingGuildsRef = false;
            }
          }
        } else if (!currentUser) {
          // Not logged in
          setGuilds([]);
          setCurrentGuildState(null);
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

      // Only process specific events
      if (event === 'SIGNED_OUT') {
        console.log('[AuthContext] User signed out, clearing guilds');
        setUser(null);
        setGuilds([]);
        setCurrentGuildState(null);
        localStorage.removeItem('currentGuildId');
      } else if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session?.user) {
        console.log('[AuthContext] User authenticated, fetching guilds');
        setUser(session.user);

        // Fetch guilds when user signs in
        if (!loadingGuildsRef && mounted) {
          loadingGuildsRef = true;
          setIsLoadingGuilds(true);

          try {
            // Fetch user's guilds directly (more reliable than RPC)
            console.log('[AuthContext] Fetching guilds for user:', session.user.id);

            const { data: userGuilds, error } = await supabase
              .from('guild_members')
              .select(`
                guild_id,
                role,
                joined_at,
                guilds!inner (
                  name
                )
              `)
              .eq('user_id', session.user.id)
              .order('joined_at', { ascending: true });

            console.log('[AuthContext] Query result:', { userGuilds, error });

            if (!mounted) return;

            if (error) {
              console.error('[AuthContext] Error fetching guilds:', error);
              console.error('[AuthContext] Error details:', {
                message: error.message,
                code: error.code,
                details: error.details,
                hint: error.hint
              });
              setGuilds([]);
            } else if (userGuilds && Array.isArray(userGuilds) && userGuilds.length > 0) {
              console.log('[AuthContext] Found guilds:', userGuilds);

              // Transform the data to match GuildMembership interface
              const transformedGuilds: GuildMembership[] = userGuilds.map((g: any) => ({
                guild_id: g.guild_id,
                guild_name: g.guilds.name,
                role: g.role as 'MEMBER' | 'OFFICER' | 'DEPUTY' | 'LEADER',
                joined_at: g.joined_at,
              }));

              setGuilds(transformedGuilds);

              const savedGuildId = localStorage.getItem('currentGuildId');
              const savedGuild = transformedGuilds.find((g) => g.guild_id === savedGuildId);
              setCurrentGuildState(savedGuild || transformedGuilds[0]);
            } else {
              console.log('[AuthContext] No guilds found for user');
              setGuilds([]);
              setCurrentGuildState(null);
            }
          } catch (fetchError) {
            console.error('[AuthContext] Error fetching guilds:', fetchError);
            if (mounted) setGuilds([]);
          } finally {
            if (mounted) {
              setIsLoadingGuilds(false);
              loadingGuildsRef = false;
            }
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
    if (!currentGuild) return false;

    const roleHierarchy = { MEMBER: 0, OFFICER: 1, DEPUTY: 2, LEADER: 3 };
    const userRoleLevel = roleHierarchy[currentGuild.role];
    const requiredRoleLevel = roleHierarchy[requiredRole];

    return userRoleLevel >= requiredRoleLevel;
  };

  const value = {
    user,
    loading: loading || isLoadingGuilds, // Include guild loading in overall loading state
    guilds,
    currentGuild,
    setCurrentGuild,
    signIn,
    signUp,
    signOut,
    hasRole,
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
