'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader2, UserCircle, X } from 'lucide-react';
import { useAuth, type AccountCharacter } from '@/contexts/AuthContext';

interface Claim {
  id: string;
  status: 'pending' | 'approved' | 'rejected';
  note: string | null;
  requested_at: string;
  member: { id: string; ign: string; avatar_url: string | null } | null;
}

interface SearchResult {
  member_id: string;
  ign: string;
  avatar_url: string | null;
  total_level: number | null;
  guild_nickname: string | null;
  guild_name: string | null;
  taken: boolean;
  taken_status: 'claimed' | 'pending' | null;
  mine: boolean;
}

const STATUS_STYLE: Record<Claim['status'], string> = {
  pending: 'bg-amber-500/20 text-amber-400 border-amber-500/50',
  approved: 'bg-green-500/20 text-green-500 border-green-500/50',
  rejected: 'bg-red-500/20 text-red-500 border-red-500/50',
};

export default function AccountPage() {
  const { user, loading, refreshAccount } = useAuth();
  const [characters, setCharacters] = useState<AccountCharacter[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [discord, setDiscord] = useState<{ discord_username: string | null } | null | undefined>(undefined);

  const load = useCallback(async () => {
    fetch('/api/account/discord-link', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { link: null }))
      .then((d) => setDiscord(d.link ?? null))
      .catch(() => setDiscord(null));
    const res = await fetch('/api/account/characters', { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    setCharacters(data.characters ?? []);
    setClaims(data.claims ?? []);
  }, []);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setSearching(true);
      const res = await fetch(`/api/account/search?q=${encodeURIComponent(q.trim())}`, { cache: 'no-store' });
      setSearching(false);
      if (res.ok) setResults((await res.json()).results ?? []);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  async function claim(r: SearchResult) {
    setMsg(null);
    const res = await fetch('/api/account/claims', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ member_id: r.member_id }),
    });
    const data = await res.json();
    if (!res.ok) return setMsg({ tone: 'err', text: data.error ?? 'Request failed' });
    setMsg({ tone: 'ok', text: `Requested ${r.ign}. A leader, deputy or officer of ${r.guild_nickname ?? 'the guild'} will review it.` });
    setQ('');
    load();
  }

  async function remove(c: Claim) {
    const text = c.status === 'approved'
      ? `Release ${c.member?.ign}? Only do this if you claimed an account that isn't yours. You lose all access that came from it and its alts, and you'll need to claim and get approved again.`
      : `Cancel your request for ${c.member?.ign}?`;
    if (!confirm(text)) return;
    await fetch(`/api/account/claims?id=${c.id}`, { method: 'DELETE' });
    await load();
    refreshAccount();
    if (c.status === 'approved') window.location.reload(); // guild access may have changed
  }

  async function unlinkDiscord() {
    if (!confirm('Unlink your Discord? /me and /away in Discord stop working for you until you run /claim again. Your guild roles stay as they are.')) return;
    await fetch('/api/account/discord-link', { method: 'DELETE' });
    setDiscord(null);
  }

  if (loading) return <Loader2 className="h-6 w-6 animate-spin mx-auto mt-16" />;
  if (!user) {
    return (
      <div className="max-w-xl mx-auto py-16 text-center space-y-3">
        <p>Sign in to claim your character.</p>
        <Link href="/login"><Button>Sign in</Button></Link>
      </div>
    );
  }

  const pending = claims.filter((c) => c.status !== 'approved');
  const approved = claims.filter((c) => c.status === 'approved');
  // One IdleMMO account per website user: a pending or approved claim blocks new ones.
  const activeClaim = claims.find((c) => c.status === 'pending' || c.status === 'approved');

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <UserCircle className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">My characters</h1>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Characters on your account</CardTitle>
          <CardDescription>
            Approved characters plus their alts, found automatically. Your guild access follows where these characters
            are right now and their in-game rank, so it updates when one changes guild, gets promoted, or leaves.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {characters.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {activeClaim ? 'None yet. Your characters show up here once your claim is approved.' : 'None yet. Claim your main below — alts come with it once it’s approved.'}
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {characters.map((c) => (
                <div key={c.member_id} className={`flex items-center gap-2 border rounded px-2 py-1.5 text-sm ${c.in_dream_guild ? '' : 'opacity-50'}`}>
                  {c.avatar_url && <img src={c.avatar_url} alt="" className="h-8 w-8 rounded" />}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{c.ign} {!c.claimed && <span className="text-xs text-muted-foreground">(alt)</span>}</div>
                    <div className="text-xs text-muted-foreground">
                      {c.in_dream_guild ? `${c.guild_name} · ${c.position ?? 'member'}` : 'Not in a Dream guild'}
                    </div>
                  </div>
                  {c.guild_nickname && c.in_dream_guild && <Badge variant="secondary">{c.guild_nickname}</Badge>}
                </div>
              ))}
            </div>
          )}
          {approved.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              {approved.map((c) => (
                <span key={c.id} className="inline-flex items-center gap-1 border rounded px-2 py-0.5">
                  Claimed: {c.member?.ign}
                </span>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {discord !== undefined && (
        <div className="flex flex-wrap items-center gap-2 border rounded-lg px-3 py-2 text-sm">
          <span className="font-medium">Discord</span>
          {discord ? (
            <>
              <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/40">linked{discord.discord_username ? ` · ${discord.discord_username}` : ''}</Badge>
              <span className="text-xs text-muted-foreground">Your guild roles follow your characters; /me and /away work in Discord.</span>
              <button onClick={unlinkDiscord} className="ml-auto text-xs text-muted-foreground underline hover:text-red-500">Unlink</button>
            </>
          ) : (
            <span className="text-muted-foreground">
              Not linked. Run <code className="text-xs">/claim</code> in the Dream Guilds Discord and press “Link my account”.
            </span>
          )}
        </div>
      )}

      {pending.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Requests</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {pending.map((c) => (
              <div key={c.id} className="flex items-center gap-2 text-sm">
                <span className="font-medium">{c.member?.ign ?? 'Unknown'}</span>
                <Badge className={STATUS_STYLE[c.status]} variant="outline">{c.status}</Badge>
                {c.note && <span className="text-xs text-muted-foreground">“{c.note}”</span>}
                <span className="text-xs text-muted-foreground ml-auto">{new Date(c.requested_at).toLocaleDateString()}</span>
                <button title="Remove" onClick={() => remove(c)} className="text-muted-foreground hover:text-red-500"><X className="h-4 w-4" /></button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {approved.length > 0 && (
        <p className="text-xs text-muted-foreground px-1">
          IdleMMO allows one account per person, so your claim stays locked to it. Claimed the wrong account by mistake?{' '}
          {approved.map((c) => (
            <button key={c.id} onClick={() => remove(c)} className="underline hover:text-red-500">
              Release {c.member?.ign}
            </button>
          ))}
        </p>
      )}

      {!activeClaim && (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Claim a character</CardTitle>
          <CardDescription>
            Search your main character (it must be in a Dream guild). IdleMMO allows one account per person, so you claim it once:
            all its characters (up to 5) come with it automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input placeholder="Search IGN…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs h-9" />
          {msg && <p className={`text-sm ${msg.tone === 'ok' ? 'text-green-500' : 'text-red-500'}`}>{msg.text}</p>}
          {searching && <Loader2 className="h-4 w-4 animate-spin" />}
          <div className="grid gap-2 sm:grid-cols-2">
            {results.map((r) => {
              const onAccount = r.mine || characters.some((c) => c.member_id === r.member_id);
              const requested = claims.some((c) => c.member?.id === r.member_id && c.status === 'pending');
              return (
                <div key={r.member_id} className="flex items-center gap-2 border rounded px-2 py-1.5 text-sm">
                  {r.avatar_url && <img src={r.avatar_url} alt="" className="h-7 w-7 rounded" />}
                  <span className="flex-1 truncate">{r.ign}</span>
                  <Badge variant="secondary">{r.guild_nickname}</Badge>
                  {onAccount ? (
                    <Badge variant="outline">yours</Badge>
                  ) : r.taken ? (
                    <Badge variant="outline" className="opacity-60">{r.taken_status ?? 'claimed'}</Badge>
                  ) : requested ? (
                    <Badge variant="outline">requested</Badge>
                  ) : (
                    <Button size="sm" variant="outline" className="h-7" onClick={() => claim(r)}>Claim</Button>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
      )}
    </div>
  );
}
