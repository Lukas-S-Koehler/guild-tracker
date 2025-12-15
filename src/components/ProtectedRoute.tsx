'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2 } from 'lucide-react';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredRole?: 'MEMBER' | 'OFFICER' | 'LEADER';
}

export default function ProtectedRoute({ children, requiredRole }: ProtectedRouteProps) {
  const { user, loading, currentGuild, hasRole } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;

    // Not authenticated - redirect to login
    if (!user) {
      router.push('/login');
      return;
    }

    // No guild selected - redirect to guild selection
    if (!currentGuild) {
      router.push('/guilds');
      return;
    }

    // Check role requirement
    if (requiredRole && !hasRole(requiredRole)) {
      // Redirect to home if insufficient permissions
      router.push('/');
    }
  }, [user, loading, currentGuild, requiredRole, hasRole, router]);

  // Show loading state
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Show nothing while redirecting
  if (!user || !currentGuild) {
    return null;
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
