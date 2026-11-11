'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Crown, Shield, Users, Trash2, Plus, RefreshCw, Link as LinkIcon } from 'lucide-react';
import Link from 'next/link';
import ProtectedRoute from '@/components/ProtectedRoute';
import { useAuth } from '@/contexts/AuthContext';

interface Char {
  id: string;
  ign: string;
  hashed_id: string | null;
  guild_id: string | null;
  guild_nickname: string | null;
  position: string | null;
  character_id: number | null;
}

interface AltLink {
  id: string;
  member_id: string;
  alt_ign: string;
  alt_hashed_id: string;
  alt_member_id: string | null;
  source: 'sync' | 'manual';
  alt_character_id: number | null;
}

interface Account {
  chars: Char[];
  links: AltLink[];
}

interface OverviewPayload {
  accounts: Account[];
  totals: {
    tracked_members: number;
    accounts: number;
    manual_links: number;
    sync_links: number;
  };
}

function AltsOverviewContent() {
  const { currentGuild, isSuperAdmin } = useAuth();
  const [data, setData] = useState<OverviewPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [showAddFor, setShowAddFor] = useState<string | null>(null);
  const [newMainId, setNewMainId] = useState('');
  const [newAltId, setNewAltId] = useState('');

  const guildHeader = currentGuild?.guild_id ? { 'x-guild-id': currentGuild.guild_id } : undefined;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/alts-overview');
      if (res.ok) setData(await res.json());
      else setMessage('Failed to load');
    } catch { setMessage('Network error'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSyncAll = async () => {
    if (!confirm('Run full alt sync across all guilds? May take minutes.')) return;
    setSyncing(true);
    try {
      const res = await fetch('/api/admin/sync-alts-all', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      const d = await res.json();
      if (res.ok) {
        setMessage(`Synced: ${d.processed} fetched · ${d.alt_links_written} sync links written · ${d.manual_preserved ?? 0} manual preserved`);
        await load();
      } else setMessage(d.error || 'Sync failed');
    } catch { setMessage('Network error'); }
    finally { setSyncing(false); }
  };

  const handleDeleteManual = async (link: AltLink) => {
    if (link.source !== 'manual') return;
    if (!confirm(`Remove manual link to ${link.alt_ign}?`)) return;
    try {
      const res = await fetch(`/api/members/alts/manual?id=${link.id}`, {
        method: 'DELETE',
        headers: guildHeader,
      });
      const d = await res.json();
      if (res.ok) { setMessage('Deleted'); await load(); }
      else setMessage(d.error || 'Delete failed');
    } catch { setMessage('Network error'); }
  };

  const handleAddManual = async () => {
    if (!newMainId || !newAltId) { setMessage('Pick both chars'); return; }
    try {
      const res = await fetch('/api/members/alts/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(guildHeader ?? {}) },
        body: JSON.stringify({ main_member_id: newMainId, alt_member_id: newAltId }),
      });
      const d = await res.json();
      if (res.ok) {
        setMessage('Added');
        setNewMainId(''); setNewAltId(''); setShowAddFor(null);
        await load();
      } else setMessage(d.error || 'Add failed');
    } catch { setMessage('Network error'); }
  };

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    if (!q) return data.accounts;
    return data.accounts.filter((a) =>
      a.chars.some((c) => c.ign.toLowerCase().includes(q) || c.guild_nickname?.toLowerCase().includes(q))
    );
  }, [data, query]);

  if (!isSuperAdmin) {
    return <div className="max-w-xl mx-auto p-6 text-sm text-muted-foreground">Cross-guild overview is super-admin only. Per-guild leaders can manage manual alts from the <Link href="/admin" className="underline">Admin page</Link>.</div>;
  }

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="max-w-6xl mx-auto space-y-4 p-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><LinkIcon className="h-5 w-5" /> Alt Characters Overview</h1>
          <p className="text-sm text-muted-foreground">All tracked accounts with multiple linked characters. Manual links are permanent.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/admin"><Button size="sm" variant="outline">← Back to Admin</Button></Link>
          <Button size="sm" variant="outline" onClick={load} disabled={loading}><RefreshCw className="h-3 w-3 mr-1" />Reload</Button>
          <Button size="sm" onClick={handleSyncAll} disabled={syncing}>
            {syncing ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
            Sync All Alts
          </Button>
        </div>
      </div>

      {message && <div className="text-sm p-2 rounded bg-muted">{message}</div>}

      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Card><CardContent className="p-3 text-center"><div className="text-2xl font-bold">{data.totals.accounts}</div><div className="text-xs text-muted-foreground">Accounts</div></CardContent></Card>
          <Card><CardContent className="p-3 text-center"><div className="text-2xl font-bold">{data.totals.tracked_members}</div><div className="text-xs text-muted-foreground">Tracked chars</div></CardContent></Card>
          <Card><CardContent className="p-3 text-center"><div className="text-2xl font-bold text-blue-400">{data.totals.sync_links}</div><div className="text-xs text-muted-foreground">Sync links</div></CardContent></Card>
          <Card><CardContent className="p-3 text-center"><div className="text-2xl font-bold text-purple-400">{data.totals.manual_links}</div><div className="text-xs text-muted-foreground">Manual links</div></CardContent></Card>
        </div>
      )}

      <input
        type="text"
        placeholder="Filter by IGN or guild…"
        value={query}
        onChange={e => setQuery(e.target.value)}
        className="w-full px-3 py-1.5 rounded border bg-background text-sm"
      />

      <div className="space-y-2">
        {filtered.map((acc, idx) => {
          const key = acc.chars[0]?.id ?? String(idx);
          const allChars = acc.chars;
          const canAdd = allChars.length >= 2;
          return (
            <Card key={key}>
              <CardHeader className="py-3">
                <CardTitle className="text-sm flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-muted-foreground text-xs">Account</span>
                    {allChars.map((c) => (
                      <span key={c.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-muted text-xs">
                        {c.position === 'LEADER' && <Crown className="h-3 w-3 text-yellow-500" />}
                        {c.position === 'DEPUTY' && <Shield className="h-3 w-3 text-purple-500" />}
                        {c.position === 'OFFICER' && <Shield className="h-3 w-3 text-blue-500" />}
                        {(!c.position || (c.position !== 'LEADER' && c.position !== 'DEPUTY' && c.position !== 'OFFICER')) && <Users className="h-3 w-3 text-gray-400" />}
                        <span className="font-medium">{c.ign}</span>
                        {c.guild_nickname && <span className="text-muted-foreground">·{c.guild_nickname}</span>}
                      </span>
                    ))}
                  </div>
                  {canAdd && (
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowAddFor(showAddFor === key ? null : key)}>
                      <Plus className="h-3 w-3 mr-1" /> Manual link
                    </Button>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="py-2 space-y-2">
                {acc.links.length > 0 && (
                  <div className="space-y-1">
                    {acc.links.map((l) => (
                      <div key={l.id} className="flex items-center gap-2 text-xs">
                        <span className={`px-1.5 py-0.5 rounded font-medium ${l.source === 'manual' ? 'bg-purple-500/20 text-purple-300' : 'bg-blue-500/20 text-blue-400'}`}>
                          {l.source}
                        </span>
                        <span className="text-muted-foreground">
                          {allChars.find(c => c.id === l.member_id)?.ign ?? l.member_id.slice(0, 8)} → {l.alt_ign}
                        </span>
                        {l.source === 'manual' && (
                          <button onClick={() => handleDeleteManual(l)} className="text-destructive hover:text-destructive/80 ml-auto">
                            <Trash2 className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {showAddFor === key && (
                  <div className="flex flex-wrap items-center gap-2 pt-2 border-t">
                    <select value={newMainId} onChange={e => setNewMainId(e.target.value)} className="px-2 py-1 rounded border bg-background text-xs">
                      <option value="">Main…</option>
                      {allChars.map(c => <option key={c.id} value={c.id}>{c.ign}</option>)}
                    </select>
                    <span className="text-xs">↔</span>
                    <select value={newAltId} onChange={e => setNewAltId(e.target.value)} className="px-2 py-1 rounded border bg-background text-xs">
                      <option value="">Alt…</option>
                      {allChars.filter(c => c.id !== newMainId).map(c => <option key={c.id} value={c.id}>{c.ign}</option>)}
                    </select>
                    <Button size="sm" className="h-7 text-xs" onClick={handleAddManual}>Add</Button>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

export default function AltsOverviewPage() {
  return (
    <ProtectedRoute requiredRole="LEADER">
      <AltsOverviewContent />
    </ProtectedRoute>
  );
}
