'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Check, Loader2, UserCheck, X } from 'lucide-react';

type Status = 'pending' | 'approved' | 'rejected';

interface ClaimRow {
  id: string;
  user_id: string;
  user_name: string;
  status: Status;
  note: string | null;
  requested_at: string;
  reviewed_at: string | null;
  guild_name: string | null;
  member: { id: string; ign: string; avatar_url: string | null; total_level: number | null; discord_username: string | null };
}

interface SearchResult {
  member_id: string;
  ign: string;
  guild_nickname: string | null;
  taken: boolean;
}


export default function ClaimsAdmin() {
  const [status, setStatus] = useState<Status>('pending');
  const [rows, setRows] = useState<ClaimRow[] | null>(null);
  const [isSuper, setIsSuper] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRows(null);
    setError(null);
    const res = await fetch(`/api/admin/claims?status=${status}`, { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? 'Failed to load');
      setRows([]);
      return;
    }
    setRows(data.claims);
    setIsSuper(!!data.is_super_admin);
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  async function act(row: ClaimRow, action: 'approve' | 'reject' | 'revoke') {
    const note = action === 'approve' ? null : prompt(action === 'reject' ? 'Reason (optional, shown to the user)' : 'Reason for revoking (optional)');
    if (note === null && action !== 'approve') return;
    setBusy(row.id);
    const res = await fetch('/api/admin/claims', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: row.id, action, note: note || null }),
    });
    const data = await res.json();
    setBusy(null);
    if (!res.ok) return setError(data.error ?? 'Action failed');
    load();
  }

  return (
    <div className="max-w-5xl space-y-4">
      <div className="flex items-center gap-2">
        <UserCheck className="h-6 w-6 text-primary" />
        <h2 className="text-lg font-semibold">Character claims</h2>
        <span className="text-sm text-muted-foreground ml-2">{isSuper ? 'All guilds' : 'Characters in guilds you lead / officer'}</span>
      </div>

      <AssignCard onDone={load} />

      {isSuper && <GuildAccessCard />}

      <Card>
        <CardHeader className="pb-2 flex-row items-center gap-2 space-y-0">
          <CardTitle className="text-base">Requests</CardTitle>
          <div className="ml-auto flex gap-1">
            {(['pending', 'approved', 'rejected'] as Status[]).map((s) => (
              <Button key={s} size="sm" variant={status === s ? 'default' : 'outline'} onClick={() => setStatus(s)} className="capitalize">{s}</Button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {error && <p className="text-sm text-red-500 mb-2">{error}</p>}
          {!rows ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing {status}.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground text-left">
                <tr><th className="py-1">Website user</th><th>Character</th><th>Guild</th><th>Discord</th><th>Requested</th><th /></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="py-1.5">{r.user_name}</td>
                    <td className="flex items-center gap-1.5 py-1.5">
                      {r.member.avatar_url && <img src={r.member.avatar_url} alt="" className="h-6 w-6 rounded" />}
                      {r.member.ign}
                    </td>
                    <td><Badge variant="secondary">{r.guild_name ?? 'left'}</Badge></td>
                    <td className="text-xs text-muted-foreground">{r.member.discord_username ?? '—'}</td>
                    <td className="text-xs text-muted-foreground">
                      {new Date(r.requested_at).toLocaleDateString()}
                      {r.note && <div>“{r.note}”</div>}
                    </td>
                    <td className="text-right whitespace-nowrap">
                      {busy === r.id ? (
                        <Loader2 className="h-4 w-4 animate-spin inline" />
                      ) : status === 'pending' ? (
                        <>
                          <Button size="sm" className="h-7 mr-1" onClick={() => act(r, 'approve')}><Check className="h-3.5 w-3.5 mr-1" />Approve</Button>
                          <Button size="sm" variant="outline" className="h-7" onClick={() => act(r, 'reject')}><X className="h-3.5 w-3.5 mr-1" />Reject</Button>
                        </>
                      ) : status === 'approved' ? (
                        <Button size="sm" variant="outline" className="h-7" onClick={() => act(r, 'revoke')}>Revoke</Button>
                      ) : (
                        <Button size="sm" variant="outline" className="h-7" onClick={() => act(r, 'approve')}>Approve anyway</Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AssignCard({ onDone }: { onDone: () => void }) {
  const [who, setWho] = useState('');
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [picked, setPicked] = useState<SearchResult | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (q.trim().length < 2 || picked) return setResults([]);
    const t = setTimeout(async () => {
      const res = await fetch(`/api/account/search?q=${encodeURIComponent(q.trim())}`, { cache: 'no-store' });
      if (res.ok) setResults((await res.json()).results ?? []);
    }, 300);
    return () => clearTimeout(t);
  }, [q, picked]);

  async function assign() {
    if (!picked || !who.trim()) return;
    const body = who.includes('@') ? { email: who.trim(), member_id: picked.member_id } : { username: who.trim(), member_id: picked.member_id };
    const res = await fetch('/api/admin/claims/assign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) return setMsg({ ok: false, text: data.error ?? 'Assign failed' });
    setMsg({ ok: true, text: `Linked ${picked.ign}. Guild access updated (+${data.access.added} / ~${data.access.updated} / −${data.access.removed}).` });
    setPicked(null);
    setQ('');
    setWho('');
    onDone();
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Assign directly</CardTitle>
        <CardDescription>Link a character to a website account without a request. Alts come along automatically.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex flex-wrap gap-2 items-center">
          <Input className="h-8 w-56" placeholder="Username or email" value={who} onChange={(e) => setWho(e.target.value)} />
          {picked ? (
            <span className="inline-flex items-center gap-1 border rounded px-2 h-8 text-sm">
              {picked.ign} <Badge variant="secondary">{picked.guild_nickname}</Badge>
              <button onClick={() => setPicked(null)}><X className="h-3.5 w-3.5" /></button>
            </span>
          ) : (
            <Input className="h-8 w-56" placeholder="Character IGN…" value={q} onChange={(e) => setQ(e.target.value)} />
          )}
          <Button size="sm" onClick={assign} disabled={!picked || !who.trim()}>Assign</Button>
        </div>
        {!picked && results.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {results.map((r) => (
              <button key={r.member_id} onClick={() => setPicked(r)} className="text-xs border rounded px-2 py-1 hover:bg-muted">
                {r.ign} · {r.guild_nickname}{r.taken ? ' · claimed' : ''}
              </button>
            ))}
          </div>
        )}
        {msg && <p className={`text-sm ${msg.ok ? 'text-green-500' : 'text-red-500'}`}>{msg.text}</p>}
      </CardContent>
    </Card>
  );
}

interface AccessUser {
  user_id: string;
  user_name: string;
  characters: { ign: string; guild: string | null; position: string | null; in_dream_guild: boolean; claimed: boolean }[];
  access: { id: string; guild_id: string; guild_name: string; role: string; source: 'manual' | 'derived' }[];
}

/** Super admin: review existing guild access rows — override, hand back to game sync, or delete. */
function GuildAccessCard() {
  const [users, setUsers] = useState<AccessUser[] | null>(null);
  const [filter, setFilter] = useState<'all' | 'manual' | 'unlinked'>('manual');
  const [q, setQ] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/guild-access', { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok) return setErr(data.error ?? 'Failed to load');
    setUsers(data.users);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function call(method: 'PATCH' | 'DELETE', body: { id: string; role?: string; source?: string }) {
    setErr(null);
    const res =
      method === 'DELETE'
        ? await fetch(`/api/admin/guild-access?id=${body.id}`, { method })
        : await fetch('/api/admin/guild-access', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) setErr((await res.json()).error ?? 'Failed');
    load();
  }

  const shown = (users ?? []).filter((u) => {
    if (q && !u.user_name.toLowerCase().includes(q.toLowerCase()) && !u.characters.some((c) => c.ign.toLowerCase().includes(q.toLowerCase()))) return false;
    if (filter === 'manual') return u.access.some((a) => a.source === 'manual');
    if (filter === 'unlinked') return u.characters.length === 0;
    return true;
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Guild access (super admin)</CardTitle>
        <CardDescription>
          <b>derived</b> rows follow the in-game rank of the user&apos;s characters and update on every sync. <b>manual</b> rows are your
          overrides and never change on their own. Use <i>Follow game</i> once a user has claimed their character, or delete stale rows.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2 items-center">
          <Input className="h-8 w-56" placeholder="Filter user or IGN…" value={q} onChange={(e) => setQ(e.target.value)} />
          {(['manual', 'unlinked', 'all'] as const).map((f) => (
            <Button key={f} size="sm" variant={filter === f ? 'default' : 'outline'} onClick={() => setFilter(f)}>
              {f === 'manual' ? 'Has manual rows' : f === 'unlinked' ? 'No character linked' : 'All'}
            </Button>
          ))}
        </div>
        {err && <p className="text-sm text-red-500">{err}</p>}
        {!users ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <div className="space-y-2">
            {shown.map((u) => (
              <div key={u.user_id} className="border rounded p-2 text-sm space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{u.user_name}</span>
                  {u.characters.length === 0 ? (
                    <span className="text-xs text-amber-400">no character linked — assign one above</span>
                  ) : (
                    u.characters.map((c) => (
                      <span key={c.ign} className={`text-xs border rounded px-1.5 ${c.in_dream_guild ? '' : 'opacity-50'}`}>
                        {c.ign}{c.claimed ? '' : ' (alt)'} · {c.in_dream_guild ? `${c.guild} ${c.position ?? ''}` : 'left'}
                      </span>
                    ))
                  )}
                </div>
                {u.access.length === 0 && <div className="text-xs text-muted-foreground">No guild access rows.</div>}
                {u.access.map((a) => (
                  <div key={a.id} className="flex flex-wrap items-center gap-2 pl-2">
                    <Badge variant="secondary" className="w-12 justify-center">{a.guild_name}</Badge>
                    <select
                      className="h-7 rounded-md border border-input bg-background px-1 text-xs"
                      value={a.role}
                      onChange={(e) => call('PATCH', { id: a.id, role: e.target.value })}
                      title="Changing the role makes this a manual override"
                    >
                      {['MEMBER', 'OFFICER', 'DEPUTY', 'LEADER'].map((r) => <option key={r}>{r}</option>)}
                    </select>
                    <Badge variant="outline" className={a.source === 'derived' ? 'text-green-500 border-green-500/50' : 'text-amber-400 border-amber-500/50'}>
                      {a.source}
                    </Badge>
                    {a.source === 'manual' && (
                      <Button size="sm" variant="outline" className="h-7" disabled={u.characters.length === 0} onClick={() => call('PATCH', { id: a.id, source: 'derived' })}>
                        Follow game
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-muted-foreground hover:text-red-500"
                      onClick={() => confirm(`Remove ${u.user_name}'s ${a.guild_name} access?`) && call('DELETE', { id: a.id })}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            ))}
            {shown.length === 0 && <p className="text-sm text-muted-foreground">Nobody matches.</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
