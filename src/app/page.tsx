'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import Landing from '@/components/guilds/Landing';

/**
 * Home. Logged out: the public landing page. Signed in: staff (officer+ in any guild) go to
 * the admin hub, everyone else to their /me dashboard. The network dashboard lives at /network.
 */
export default function HomePage() {
  const { user, loading, guilds, isSuperAdmin, isAwaitingAssignment } = useAuth();
  const router = useRouter();
  const isStaff = isSuperAdmin || (!isAwaitingAssignment && guilds.some((g) => g.role !== 'MEMBER'));
  const home = loading || !user ? null : isStaff ? '/admin' : '/me';

  useEffect(() => {
    if (home) router.replace(home);
  }, [home, router]);

  if (!loading && !user) return <Landing />;
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}
