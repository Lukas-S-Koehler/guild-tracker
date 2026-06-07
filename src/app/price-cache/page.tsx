'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, RefreshCw, Trash2, Package, Clock, CheckCircle, AlertCircle } from 'lucide-react';
import { useApiClient } from '@/lib/api-client';
import { useAuth } from '@/contexts/AuthContext';
import ProtectedRoute from '@/components/ProtectedRoute';

interface CacheEntry {
  item_name: string;
  item_id: string | null;
  price: number;
  cached_at: string;
}

function formatAge(cached_at: string): { label: string; color: string } {
  const ageMs = Date.now() - new Date(cached_at).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  const ageHours = ageMs / (1000 * 60 * 60);

  if (ageHours < 1) {
    return { label: 'Just now', color: 'text-green-500' };
  } else if (ageHours < 24) {
    return { label: `${Math.floor(ageHours)}h ago`, color: 'text-green-500' };
  } else if (ageDays < 7) {
    return { label: `${Math.floor(ageDays)}d ago`, color: 'text-yellow-500' };
  } else {
    return { label: `${Math.floor(ageDays)}d ago`, color: 'text-red-500' };
  }
}

function formatPrice(price: number): string {
  if (price >= 1_000_000) return `${(price / 1_000_000).toFixed(1)}M`;
  if (price >= 1_000) return `${(price / 1_000).toFixed(1)}K`;
  return price.toLocaleString();
}

function PriceCacheContent() {
  const api = useApiClient();
  const { isSuperAdmin } = useAuth();
  const [entries, setEntries] = useState<CacheEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncingAll, setSyncingAll] = useState(false);
  const [syncing, setSyncing] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadEntries = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/price-cache');
      const data = await res.json();
      setEntries(data.items ?? []);
    } catch {
      setMessage({ type: 'error', text: 'Failed to load cache entries.' });
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  async function syncItem(item_name: string) {
    setSyncing((prev) => new Set(prev).add(item_name));
    try {
      const res = await api.post('/api/price-cache', { item_name });
      const data = await res.json();
      if (data.updated > 0 && data.item) {
        setEntries((prev) =>
          prev.map((e) => e.item_name === item_name ? data.item : e)
        );
        setMessage({ type: 'success', text: `Updated price for ${item_name}.` });
      } else {
        setMessage({ type: 'error', text: `Price lookup returned 0 for ${item_name}.` });
      }
    } catch {
      setMessage({ type: 'error', text: `Failed to sync ${item_name}.` });
    } finally {
      setSyncing((prev) => { const s = new Set(prev); s.delete(item_name); return s; });
    }
  }

  async function deleteItem(item_name: string) {
    setDeleting((prev) => new Set(prev).add(item_name));
    try {
      await api.fetch('/api/price-cache', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_name }),
      });
      setEntries((prev) => prev.filter((e) => e.item_name !== item_name));
      setMessage({ type: 'success', text: `Deleted ${item_name} from cache.` });
    } catch {
      setMessage({ type: 'error', text: `Failed to delete ${item_name}.` });
    } finally {
      setDeleting((prev) => { const s = new Set(prev); s.delete(item_name); return s; });
    }
  }

  async function syncAll() {
    setSyncingAll(true);
    setMessage(null);
    try {
      const res = await api.post('/api/price-cache', { sync_all: true });
      const data = await res.json();
      setMessage({
        type: data.failed?.length > 0 ? 'error' : 'success',
        text: `Updated ${data.updated} items. Failed: ${data.failed?.length ?? 0}.`,
      });
      await loadEntries();
    } catch {
      setMessage({ type: 'error', text: 'Sync all failed.' });
    } finally {
      setSyncingAll(false);
    }
  }

  if (!isSuperAdmin) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground">Super admin access required.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const oldest = entries.length > 0 ? entries[0].cached_at : null;
  const newest = entries.length > 0 ? entries[entries.length - 1].cached_at : null;
  const staleCount = entries.filter((e) => {
    const ageDays = (Date.now() - new Date(e.cached_at).getTime()) / (1000 * 60 * 60 * 24);
    return ageDays >= 7;
  }).length;

  return (
    <div className="container mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Price Cache</h1>
          <p className="text-muted-foreground text-sm">IdleMMO item price cache management</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={loadEntries} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Reload
          </Button>
          <Button onClick={syncAll} disabled={syncingAll || loading}>
            {syncingAll ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Sync All
          </Button>
        </div>
      </div>

      {message && (
        <div className={`flex items-center gap-2 p-3 rounded-md text-sm ${message.type === 'success' ? 'bg-green-500/10 text-green-500 border border-green-500/20' : 'bg-red-500/10 text-red-500 border border-red-500/20'}`}>
          {message.type === 'success' ? <CheckCircle className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
          {message.text}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Total Items</span>
            </div>
            <p className="text-2xl font-bold mt-1">{entries.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-red-500" />
              <span className="text-sm text-muted-foreground">Stale (&gt;7d)</span>
            </div>
            <p className="text-2xl font-bold mt-1 text-red-500">{staleCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Oldest</span>
            </div>
            <p className="text-sm font-medium mt-1">
              {oldest ? formatAge(oldest).label : '—'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span className="text-sm text-muted-foreground">Newest</span>
            </div>
            <p className="text-sm font-medium mt-1">
              {newest ? formatAge(newest).label : '—'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Cache table */}
      <Card>
        <CardHeader>
          <CardTitle>Cached Items</CardTitle>
          <CardDescription>Sorted stalest first. Red = &gt;7 days, yellow = 1–7 days, green = &lt;1 day.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : entries.length === 0 ? (
            <p className="text-muted-foreground text-sm py-6 text-center">No cached items found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-2 pr-4 font-medium">Item</th>
                    <th className="text-left py-2 pr-4 font-medium">Item ID</th>
                    <th className="text-right py-2 pr-4 font-medium">Price</th>
                    <th className="text-left py-2 pr-4 font-medium">Cached At</th>
                    <th className="text-left py-2 pr-4 font-medium">Age</th>
                    <th className="text-right py-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => {
                    const age = formatAge(entry.cached_at);
                    const isSyncingThis = syncing.has(entry.item_name);
                    const isDeletingThis = deleting.has(entry.item_name);
                    return (
                      <tr key={entry.item_name} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="py-2 pr-4 font-medium capitalize">{entry.item_name}</td>
                        <td className="py-2 pr-4 text-muted-foreground font-mono text-xs">
                          {entry.item_id ? (
                            <span title={entry.item_id}>{entry.item_id.slice(0, 12)}…</span>
                          ) : (
                            <span className="italic">none</span>
                          )}
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums">
                          {formatPrice(entry.price)} g
                        </td>
                        <td className="py-2 pr-4 text-muted-foreground">
                          {new Date(entry.cached_at).toLocaleDateString()} {new Date(entry.cached_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className={`py-2 pr-4 font-medium ${age.color}`}>
                          {age.label}
                        </td>
                        <td className="py-2 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => syncItem(entry.item_name)}
                              disabled={isSyncingThis || isDeletingThis || syncingAll}
                              title="Sync price"
                            >
                              {isSyncingThis ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => deleteItem(entry.item_name)}
                              disabled={isSyncingThis || isDeletingThis || syncingAll}
                              title="Delete from cache"
                              className="text-red-500 hover:text-red-600"
                            >
                              {isDeletingThis ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function PriceCachePage() {
  return (
    <ProtectedRoute requiredRole="LEADER">
      <PriceCacheContent />
    </ProtectedRoute>
  );
}
