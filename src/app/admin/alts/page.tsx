'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Crown, Shield, Users, Trash2, Plus, RefreshCw, Link as LinkIcon, Search, X } from 'lucide-react';
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

type SourceFilter = 'all' | 'manual' | 'sync' | 'mixed';
type ExemptFilter = 'all' | 'exempt' | 'non-exempt';

function positionBadge(pos: string | null | undefined) {
  if (pos === 'LEADER') return <Crown className="h-3 w-3 text-yellow-500" />;
  if (pos === 'DEPUTY') return <Shield className="h-3 w-3 text-purple-500" />;
  if (pos === 'OFFICER') return <Shield className="h-3 w-3 text-blue-500" />;
  return <Users className="h-3 w-3 text-gray-400" />;
}

function AltsOverviewContent() {
  const { currentGuild, isSuperAdmin } = useAuth();
  const [data, setData] = useState<OverviewPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [linkingDiscord, setLinkingDiscord] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Filters
  const [query, setQuery] = useState('');
  const [guildFilter, setGuildFilter] = useState<string>('');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [exemptFilter, setExemptFilter] = useState<ExemptFilter>('all');
  const [sortBy, setSortBy] = useState<'size' | 'alpha'>('size');

  // Global manual link form
  const [globalMainQuery, setGlobalMainQuery] = useState('');
  const [globalAltQuery, setGlobalAltQuery] = useState('');
  const [globalMainId, setGlobalMainId] = useState<string>('');
  const [globalAltId, setGlobalAltId] = useState<string>('');
  const [addingGlobal, setAddingGlobal] = useState(false);

  // Per-account add form
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

  const flash = (text: string) => {
    setMessage(text);
    setTimeout(() => setMessage(null), 4000);
  };

  const handleSyncAll = async () => {
    if (!confirm('Run full alt sync across all guilds? May take minutes.')) return;
    setSyncing(true);
    try {
      const res = await fetch('/api/admin/sync-alts-all', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      const d = await res.json();
      if (res.ok) {
        flash(`Synced: ${d.processed} fetched · ${d.alt_links_written} sync links · ${d.manual_preserved ?? 0} manual preserved`);
        await load();
      } else flash(d.error || 'Sync failed');
    } catch { flash('Network error'); }
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
      if (res.ok) { flash('Deleted'); await load(); }
      else flash(d.error || 'Delete failed');
    } catch { flash('Network error'); }
  };

  const postManualLink = async (mainId: string, altId: string): Promise<boolean> => {
    try {
      const res = await fetch('/api/members/alts/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(guildHeader ?? {}) },
        body: JSON.stringify({ main_member_id: mainId, alt_member_id: altId }),
      });
      const d = await res.json();
      if (res.ok) { flash('Manual link saved'); await load(); return true; }
      flash(d.error || 'Add failed');
      return false;
    } catch { flash('Network error'); return false; }
  };

  const handleAddManualInAccount = async () => {
    if (!newMainId || !newAltId) return flash('Pick both chars');
    const ok = await postManualLink(newMainId, newAltId);
    if (ok) { setNewMainId(''); setNewAltId(''); setShowAddFor(null); }
  };

  const handleAddGlobal = async () => {
    if (!globalMainId || !globalAltId) return flash('Pick both chars');
    setAddingGlobal(true);
    const ok = await postManualLink(globalMainId, globalAltId);
    setAddingGlobal(false);
    if (ok) {
      setGlobalMainId(''); setGlobalAltId('');
      setGlobalMainQuery(''); setGlobalAltQuery('');
    }
  };

  // Flatten all tracked chars for global search
  const allChars: Char[] = useMemo(() => {
    if (!data) return [];
    const out: Char[] = [];
    for (const acc of data.accounts) for (const c of acc.chars) out.push(c);
    return out;
  }, [data]);

  const guildOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const c of allChars) {
      if (c.guild_id && !seen.has(c.guild_id)) seen.set(c.guild_id, c.guild_nickname ?? c.guild_id);
    }
    return Array.from(seen.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [allChars]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();

    let accounts = data.accounts.filter((acc) => {
      if (guildFilter && !acc.chars.some((c) => c.guild_id === guildFilter)) return false;
      if (q && !acc.chars.some((c) =>
        c.ign.toLowerCase().includes(q) ||
        c.guild_nickname?.toLowerCase().includes(q) ||
        c.hashed_id?.toLowerCase().includes(q)
      )) return false;

      if (sourceFilter !== 'all') {
        const sources = new Set(acc.links.map((l) => l.source));
        if (sourceFilter === 'manual' && !sources.has('manual')) return false;
        if (sourceFilter === 'sync' && (sources.has('manual') || !sources.has('sync'))) return false;
        if (sourceFilter === 'mixed' && (!sources.has('manual') || !sources.has('sync'))) return false;
      }

      if (exemptFilter !== 'all') {
        const hasExempt = acc.chars.some((c) => c.position === 'LEADER' || c.position === 'DEPUTY');
        if (exemptFilter === 'exempt' && !hasExempt) return false;
        if (exemptFilter === 'non-exempt' && hasExempt) return false;
      }

      return true;
    });

    accounts = [...accounts].sort((a, b) => {
      if (sortBy === 'size') return b.chars.length - a.chars.length;
      return (a.chars[0]?.ign ?? '').localeCompare(b.chars[0]?.ign ?? '');
    });

    return accounts;
  }, [data, query, guildFilter, sourceFilter, exemptFilter, sortBy]);

  const globalMainOptions = useMemo(() => {
    const q = globalMainQuery.trim().toLowerCase();
    if (!q) return [];
    return allChars.filter((c) => c.ign.toLowerCase().includes(q)).slice(0, 10);
  }, [allChars, globalMainQuery]);

  const globalAltOptions = useMemo(() => {
    const q = globalAltQuery.trim().toLowerCase();
    if (!q) return [];
    return allChars.filter((c) => c.ign.toLowerCase().includes(q) && c.id !== globalMainId).slice(0, 10);
  }, [allChars, globalAltQuery, globalMainId]);

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
          <p className="text-sm text-muted-foreground">Cross-guild view. Primary manual method: share discord_id across chars (auto-links). Fallback: form below. Deputy+ char exempts entire account from activity checks.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/admin"><Button size="sm" variant="outline">← Admin</Button></Link>
          <Button size="sm" variant="outline" onClick={load} disabled={loading}><RefreshCw className="h-3 w-3 mr-1" />Reload</Button>
          <Button size="sm" variant="outline" onClick={async () => {
            if (!confirm('Create manual alt links for every pair of members sharing a Discord ID?')) return;
            setLinkingDiscord(true);
            try {
              const res = await fetch('/api/admin/link-alts-by-discord', { method: 'POST' });
              const d = await res.json();
              if (res.ok) { flash(`Linked ${d.accounts_processed} accounts · ${d.links_created} manual rows`); await load(); }
              else flash(d.error || 'Failed');
            } catch { flash('Network error'); }
            finally { setLinkingDiscord(false); }
          }} disabled={linkingDiscord}>
            {linkingDiscord ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
            Link by Discord
          </Button>
          <Button size="sm" onClick={handleSyncAll} disabled={syncing}>
            {syncing ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
            Sync All Alts
          </Button>
        </div>
      </div>

      {message && <div className="text-sm p-2 rounded bg-muted">{message}</div>}

      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Card><CardContent className="p-3 text-center"><div className="text-2xl font-bold">{data.totals.accounts}</div><div className="text-xs text-muted-foreground">Multi-char accounts</div></CardContent></Card>
          <Card><CardContent className="p-3 text-center"><div className="text-2xl font-bold">{data.totals.tracked_members}</div><div className="text-xs text-muted-foreground">Tracked chars</div></CardContent></Card>
          <Card><CardContent className="p-3 text-center"><div className="text-2xl font-bold text-blue-400">{data.totals.sync_links}</div><div className="text-xs text-muted-foreground">Sync links</div></CardContent></Card>
          <Card><CardContent className="p-3 text-center"><div className="text-2xl font-bold text-purple-400">{data.totals.manual_links}</div><div className="text-xs text-muted-foreground">Manual links</div></CardContent></Card>
        </div>
      )}

      {/* Global manual link form */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm flex items-center gap-2"><Plus className="h-4 w-4" />Manually link any two tracked chars</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-muted-foreground">Use when sync hides alts from the API. Both chars must already be tracked (any guild). Sync preserves manual links.</p>
          <div className="grid sm:grid-cols-[1fr_auto_1fr_auto] gap-2 items-start">
            <div className="relative">
              <Search className="absolute left-2 top-2 h-3 w-3 text-muted-foreground" />
              <input
                className="w-full pl-7 pr-2 py-1.5 rounded border bg-background text-xs"
                placeholder="Search main IGN…"
                value={globalMainQuery}
                onChange={e => { setGlobalMainQuery(e.target.value); setGlobalMainId(''); }}
              />
              {globalMainOptions.length > 0 && !globalMainId && (
                <div className="absolute z-10 left-0 right-0 top-full mt-1 border rounded bg-popover shadow-lg max-h-48 overflow-y-auto">
                  {globalMainOptions.map(c => (
                    <button
                      key={c.id}
                      onClick={() => { setGlobalMainId(c.id); setGlobalMainQuery(`${c.ign}${c.guild_nickname ? ` · ${c.guild_nickname}` : ''}`); }}
                      className="w-full text-left px-2 py-1 text-xs hover:bg-muted flex items-center gap-1"
                    >
                      {positionBadge(c.position)}
                      <span className="font-medium">{c.ign}</span>
                      {c.guild_nickname && <span className="text-muted-foreground">· {c.guild_nickname}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <span className="text-xs text-muted-foreground self-center">↔</span>
            <div className="relative">
              <Search className="absolute left-2 top-2 h-3 w-3 text-muted-foreground" />
              <input
                className="w-full pl-7 pr-2 py-1.5 rounded border bg-background text-xs"
                placeholder="Search alt IGN…"
                value={globalAltQuery}
                onChange={e => { setGlobalAltQuery(e.target.value); setGlobalAltId(''); }}
              />
              {globalAltOptions.length > 0 && !globalAltId && (
                <div className="absolute z-10 left-0 right-0 top-full mt-1 border rounded bg-popover shadow-lg max-h-48 overflow-y-auto">
                  {globalAltOptions.map(c => (
                    <button
                      key={c.id}
                      onClick={() => { setGlobalAltId(c.id); setGlobalAltQuery(`${c.ign}${c.guild_nickname ? ` · ${c.guild_nickname}` : ''}`); }}
                      className="w-full text-left px-2 py-1 text-xs hover:bg-muted flex items-center gap-1"
                    >
                      {positionBadge(c.position)}
                      <span className="font-medium">{c.ign}</span>
                      {c.guild_nickname && <span className="text-muted-foreground">· {c.guild_nickname}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <Button size="sm" onClick={handleAddGlobal} disabled={addingGlobal || !globalMainId || !globalAltId}>
              {addingGlobal ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Link'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2 top-2 h-3 w-3 text-muted-foreground" />
          <input
            className="w-full pl-7 pr-7 py-1.5 rounded border bg-background text-sm"
            placeholder="Search IGN, guild, hashed_id…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          {query && (
            <button onClick={() => setQuery('')} className="absolute right-2 top-2 text-muted-foreground"><X className="h-3 w-3" /></button>
          )}
        </div>
        <select value={guildFilter} onChange={e => setGuildFilter(e.target.value)} className="px-2 py-1.5 rounded border bg-background text-xs">
          <option value="">All guilds</option>
          {guildOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value as SourceFilter)} className="px-2 py-1.5 rounded border bg-background text-xs">
          <option value="all">All sources</option>
          <option value="manual">Has manual</option>
          <option value="sync">Sync only</option>
          <option value="mixed">Mixed (sync + manual)</option>
        </select>
        <select value={exemptFilter} onChange={e => setExemptFilter(e.target.value as ExemptFilter)} className="px-2 py-1.5 rounded border bg-background text-xs">
          <option value="all">All accounts</option>
          <option value="exempt">Deputy+ (exempt)</option>
          <option value="non-exempt">Not exempt</option>
        </select>
        <select value={sortBy} onChange={e => setSortBy(e.target.value as 'size' | 'alpha')} className="px-2 py-1.5 rounded border bg-background text-xs">
          <option value="size">Sort: # chars</option>
          <option value="alpha">Sort: alpha</option>
        </select>
        <span className="text-xs text-muted-foreground">{filtered.length} of {data?.accounts.length ?? 0}</span>
      </div>

      {/* Account cards */}
      <div className="space-y-2">
        {filtered.map((acc, idx) => {
          const key = acc.chars[0]?.id ?? String(idx);
          const chars = acc.chars;
          const hasExempt = chars.some((c) => c.position === 'LEADER' || c.position === 'DEPUTY');
          const main = chars[0];
          return (
            <Card key={key} className={hasExempt ? 'border-purple-500/30' : ''}>
              <CardHeader className="py-3">
                <CardTitle className="text-sm flex items-start justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    {hasExempt && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-purple-500/20 text-purple-300 font-medium">
                        EXEMPT
                      </span>
                    )}
                    {main && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-yellow-500/10 border border-yellow-500/30 text-xs">
                        <Crown className="h-3 w-3 text-yellow-500" />
                        <span className="font-semibold">{main.ign}</span>
                        {main.guild_nickname && <span className="text-muted-foreground">· {main.guild_nickname}</span>}
                      </span>
                    )}
                    {chars.slice(1).map((c) => (
                      <span key={c.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-muted text-xs">
                        {positionBadge(c.position)}
                        <span className="font-medium">{c.ign}</span>
                        {c.guild_nickname && <span className="text-muted-foreground">· {c.guild_nickname}</span>}
                      </span>
                    ))}
                  </div>
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowAddFor(showAddFor === key ? null : key)}>
                    <Plus className="h-3 w-3 mr-1" /> Link in account
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent className="py-2 space-y-2">
                {acc.links.length > 0 ? (
                  <div className="space-y-1">
                    {acc.links.map((l) => {
                      const mainChar = chars.find(c => c.id === l.member_id);
                      const altChar = chars.find(c => c.id === l.alt_member_id);
                      return (
                        <div key={l.id} className="flex items-center gap-2 text-xs">
                          <span className={`px-1.5 py-0.5 rounded font-medium ${l.source === 'manual' ? 'bg-purple-500/20 text-purple-300' : 'bg-blue-500/20 text-blue-400'}`}>
                            {l.source}
                          </span>
                          <span className="text-muted-foreground">
                            {mainChar?.ign ?? l.member_id.slice(0, 8)} → {altChar?.ign ?? l.alt_ign}
                            {!altChar && <span className="text-orange-400 ml-1">(untracked)</span>}
                          </span>
                          {l.source === 'manual' && (
                            <button onClick={() => handleDeleteManual(l)} className="text-destructive hover:text-destructive/80 ml-auto">
                              <Trash2 className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground italic">No link rows (account inferred by shared chars).</p>
                )}
                {showAddFor === key && chars.length >= 2 && (
                  <div className="flex flex-wrap items-center gap-2 pt-2 border-t">
                    <select value={newMainId} onChange={e => setNewMainId(e.target.value)} className="px-2 py-1 rounded border bg-background text-xs">
                      <option value="">Main…</option>
                      {chars.map(c => <option key={c.id} value={c.id}>{c.ign}</option>)}
                    </select>
                    <span className="text-xs">↔</span>
                    <select value={newAltId} onChange={e => setNewAltId(e.target.value)} className="px-2 py-1 rounded border bg-background text-xs">
                      <option value="">Alt…</option>
                      {chars.filter(c => c.id !== newMainId).map(c => <option key={c.id} value={c.id}>{c.ign}</option>)}
                    </select>
                    <Button size="sm" className="h-7 text-xs" onClick={handleAddManualInAccount}>Add</Button>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
        {filtered.length === 0 && (
          <div className="text-center py-10 text-sm text-muted-foreground">No accounts match the current filters.</div>
        )}
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
