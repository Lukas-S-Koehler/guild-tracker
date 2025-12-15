'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2 } from 'lucide-react';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredRole?: 'MEMBER' | 'OFFICER' | 'LEADER';
}

export default function ProtectedRoute({ children, requiredRole }: ProtectedRouteProps) {
  const { user, loading, currentGuild, guilds, hasRole, signOut } = useAuth();
  const router = useRouter();
  const [isRedirecting, setIsRedirecting] = useState(false);

  useEffect(() => {
    if (loading) return;

    // Not authenticated - redirect to login
    if (!user) {
      setIsRedirecting(true);
      router.push('/login');
      return;
    }

    // User has no guilds at all - show a message instead of redirecting
    if (guilds.length === 0) {
      return; // Will show "no guilds" message below
    }

    // No guild selected but has guilds - redirect to guild selection
    if (!currentGuild) {
      setIsRedirecting(true);
      router.push('/guilds');
      return;
    }

    // Check role requirement
    if (requiredRole && !hasRole(requiredRole)) {
      setIsRedirecting(true);
      // Redirect to home if insufficient permissions
      router.push('/');
    }
  }, [user, loading, currentGuild, guilds, requiredRole, hasRole, router]);

  // Show loading state
  if (loading || isRedirecting) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Not authenticated
  if (!user) {
    return null; // Will redirect
  }

  // User has no guilds - show helpful message
  if (guilds.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md text-center space-y-4">
          <h1 className="text-2xl font-bold">No Guilds Found</h1>
          <p className="text-muted-foreground">
            You&apos;re not a member of any guilds yet. Contact your guild leader to get added to a guild.
          </p>
          <p className="text-sm text-muted-foreground">
            Guild leaders can add you using your email: <span className="font-mono">{user.email}</span>
          </p>
          <button
            onClick={async () => {
              await signOut();
              router.push('/login');
            }}
            className="text-primary hover:underline"
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  // No guild selected but has guilds
  if (!currentGuild) {
    return null; // Will redirect to guild selection
  }

  // Check role requirement
  if (requiredRole && !hasRole(requiredRole)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <h1 className="text-2xl font-bold">Access Denied</h1>
          <p className="text-muted-foreground">
            You need {requiredRole} permissions to access this page.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
