'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Clock } from 'lucide-react';

/** Shown to signed-in users who have no approved character yet. */
export default function AccountBanner() {
  const { user, isAwaitingAssignment, isSuperAdmin, loading } = useAuth();
  const pathname = usePathname();
  if (loading || !user || isSuperAdmin || !isAwaitingAssignment || pathname === '/account') return null;
  return (
    <div className="border-b bg-amber-500/10 text-amber-200">
      <div className="container mx-auto px-4 py-2 text-sm flex flex-wrap items-center gap-2">
        <Clock className="h-4 w-4 shrink-0" />
        <span>You&apos;re signed in, but not assigned to a character yet. You can browse like a guest for now.</span>
        <Link href="/account" className="underline font-medium ml-auto">Claim your character →</Link>
      </div>
    </div>
  );
}
