'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase';

interface GuildMembership {
  guild_id: string;
  guild_name: string;
  role: 'MEMBER' | 'OFFICER' | 'LEADER';
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
  hasRole: (requiredRole: 'MEMBER' | 'OFFICER' | 'LEADER') => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [guilds, setGuilds] = useState<GuildMembership[]>([]);
  const [currentGuild, setCurrentGuildState] = useState<GuildMembership | null>(null);
  const [loading, setLoading] = useState(true);

  const supabase = createClient();

  // Load user and their guilds on mount
  useEffect(() => {
    async function loadUser() {
      try {
        const { data: { user: currentUser } } = await supabase.auth.getUser();
        setUser(currentUser);

        if (currentUser) {
          // Fetch user's guilds
          const { data: userGuilds, error } = await supabase
            .rpc('get_user_guilds');

          if (!error && userGuilds) {
            setGuilds(userGuilds);

            // Try to restore current guild from localStorage
            const savedGuildId = localStorage.getItem('currentGuildId');
            const savedGuild = userGuilds.find((g: GuildMembership) => g.guild_id === savedGuildId);

            // Set current guild to saved guild or first available guild
            setCurrentGuildState(savedGuild || userGuilds[0] || null);
          }
        }
      } catch (error) {
        console.error('Error loading user:', error);
      } finally {
        setLoading(false);
      }
    }

    loadUser();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      setUser(session?.user ?? null);

      if (session?.user) {
        // Reload guilds when user signs in
        const { data: userGuilds } = await supabase.rpc('get_user_guilds');
        if (userGuilds) {
          setGuilds(userGuilds);
          if (!currentGuild && userGuilds.length > 0) {
            setCurrentGuildState(userGuilds[0]);
          }
        }
      } else {
        // Clear guilds when user signs out
        setGuilds([]);
        setCurrentGuildState(null);
        localStorage.removeItem('currentGuildId');
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

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

  const hasRole = (requiredRole: 'MEMBER' | 'OFFICER' | 'LEADER') => {
    if (!currentGuild) return false;

    const roleHierarchy = { MEMBER: 0, OFFICER: 1, LEADER: 2 };
    const userRoleLevel = roleHierarchy[currentGuild.role];
    const requiredRoleLevel = roleHierarchy[requiredRole];

    return userRoleLevel >= requiredRoleLevel;
  };

  const value = {
    user,
    loading,
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
