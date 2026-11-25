'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Loader2, Lock, ShieldCheck } from 'lucide-react';
import { assaultPageLevel, useAccess, type AccessLevel } from '@/lib/use-access';
import { ClaimPrompt } from '@/components/access/ClaimPrompt';

const WHO: Record<Exclude<AccessLevel, 'public'>, string> = {
  signedIn: 'Sign in to see this page.',
  member: 'This page is for Dream guild members.',
  assaulter: 'This page is for members of our assault guilds.',
};

/** Per-area page rules (layouts are server components, so they name the area instead of passing a function). */
const AREA_LEVEL = { assault: assaultPageLevel } as const;

/** Renders children only for the given level (or the area's rule for this path); otherwise a prompt. */
export function AccessGate({
  level, area, children,
}: {
  level?: AccessLevel;
  area?: keyof typeof AREA_LEVEL;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const need = level ?? (area ? AREA_LEVEL[area](pathname) : 'public');
  const access = useAccess();
  if (need === 'public') return <>{children}</>;
  if (access.loading) {
    return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }
  if (access.has(need)) return <>{children}</>;

  const why = !access.signedIn ? WHO.signedIn : WHO[need];
  return (
    <div className="max-w-2xl mx-auto px-4 py-10 space-y-5">
      <div className="flex items-center gap-2 text-lg font-semibold">
        <Lock className="h-5 w-5 text-muted-foreground" />
        {why}
      </div>
      {/* An assault-guild page for a Dream member: claiming isn't the issue, joining is. */}
      {!(access.member && need === 'assaulter') && <ClaimPrompt signedIn={access.signedIn} />}
      {access.signedIn && (
      <Link
        href="/assault/eligibility"
        className="flex items-center gap-2 rounded-lg border p-4 text-sm hover:border-crystal/60"
      >
        <ShieldCheck className="h-5 w-5 text-crystal shrink-0" />
        <span>
          <span className="font-medium block">Could you join the assaults?</span>
          <span className="text-muted-foreground">Check your character against the assault minimum.</span>
        </span>
      </Link>
      )}
    </div>
  );
}
