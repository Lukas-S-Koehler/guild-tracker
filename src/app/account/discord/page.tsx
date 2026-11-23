'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

interface Result {
  discord_username?: string;
  claim?: { ign: string; status: 'approved' | 'pending'; auto: boolean } | null;
  conflict?: string;
  error?: string;
}

/** Landing page for the signed link from /claim in Discord. */
export default function DiscordLinkPage() {
  const { user, loading, refreshAccount } = useAuth();
  const [token, setToken] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const sent = useRef(false);

  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get('t'));
  }, []);

  useEffect(() => {
    if (!user || !token || sent.current) return;
    sent.current = true;
    (async () => {
      const res = await fetch('/api/account/discord-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = await res.json().catch(() => ({ error: 'Request failed' }));
      setResult(res.ok ? data : { error: data.error ?? 'Request failed' });
      if (res.ok) refreshAccount();
    })();
  }, [user, token, refreshAccount]);

  const here = typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/account/discord';

  let body: React.ReactNode;
  if (loading || (user && token && !result)) {
    body = <Loader2 className="h-6 w-6 animate-spin mx-auto" />;
  } else if (!token) {
    body = <p className="text-sm text-muted-foreground">This page needs the link from <code>/claim</code> in Discord. Run <code>/claim</code> there and press “Link my account”.</p>;
  } else if (!user) {
    body = (
      <div className="space-y-3">
        <p className="text-sm">Sign in to your Dream Guilds account to link your Discord. No account yet? Create one, it takes a minute.</p>
        <div className="flex gap-2">
          <Link href={`/login?next=${encodeURIComponent(here)}`}><Button>Sign in</Button></Link>
          <Link href={`/signup?next=${encodeURIComponent(here)}`}><Button variant="outline">Create account</Button></Link>
        </div>
      </div>
    );
  } else if (result?.error) {
    body = (
      <div className="flex gap-2 text-sm text-red-500">
        <XCircle className="h-5 w-5 shrink-0" />
        <span>{result.error}</span>
      </div>
    );
  } else {
    const c = result?.claim;
    body = (
      <div className="space-y-3 text-sm">
        <p className="flex items-center gap-2 text-green-500">
          <CheckCircle2 className="h-5 w-5" /> Discord {result?.discord_username ? <b>{result.discord_username}</b> : ''} linked.
        </p>
        {c?.status === 'approved' && (
          <p>{c.auto ? <>Staff already knew you, so <b>{c.ign}</b> is claimed and approved.</> : <>Your account <b>{c.ign}</b> is claimed.</>} Your guild roles in Discord update now.</p>
        )}
        {c?.status === 'pending' && <p>Your claim on <b>{c.ign}</b> is waiting for an officer of your guild.</p>}
        {result?.conflict && <p className="text-amber-500">{result.conflict}</p>}
        {!c && !result?.conflict && <p>Next: claim your main character. An officer of your guild approves it.</p>}
        <div className="flex gap-2">
          {c?.status === 'approved' ? (
            <Link href="/me"><Button>Open my dashboard</Button></Link>
          ) : (
            <Link href="/account"><Button>{c ? 'My characters' : 'Claim my character'}</Button></Link>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto py-10">
      <Card>
        <CardHeader>
          <CardTitle>Link Discord</CardTitle>
          <CardDescription>Connects your Discord to this website, so your guild roles and /me follow your characters.</CardDescription>
        </CardHeader>
        <CardContent>{body}</CardContent>
      </Card>
    </div>
  );
}
