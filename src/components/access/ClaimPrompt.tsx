import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { MessageSquare, UserCircle } from 'lucide-react';

/**
 * Big "already in a Dream guild? claim your character" prompt. Signed out: create account / sign in;
 * signed in: claim on the account page. Either way /claim in Discord is the fastest (no approval).
 */
export function ClaimPrompt({ signedIn }: { signedIn: boolean }) {
  return (
    <div className="rounded-xl border-2 border-crystal/40 bg-crystal/5 p-5 space-y-3">
      <div>
        <p className="text-lg font-semibold">Already in a Dream guild?</p>
        <p className="text-sm text-muted-foreground">
          {signedIn ? 'Claim your character' : 'Create an account or sign in, then claim your character'} to get your dashboard, the assault tools and
          everything for your guild.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {signedIn ? (
          <Button asChild><Link href="/account"><UserCircle className="h-4 w-4 mr-1" />Claim my character</Link></Button>
        ) : (
          <>
            <Button asChild><Link href="/signup">Create account</Link></Button>
            <Button asChild variant="outline"><Link href="/login">Sign in</Link></Button>
          </>
        )}
      </div>
      <p className="text-sm flex items-start gap-2">
        <MessageSquare className="h-4 w-4 mt-0.5 shrink-0 text-crystal" />
        <span>
          <b>Fastest:</b> run <code className="rounded bg-muted px-1">/claim</code> in our Discord. It links your account and claims your character
          straight away, no approval needed.
        </span>
      </p>
    </div>
  );
}
