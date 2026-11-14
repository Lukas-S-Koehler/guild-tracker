'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Loader2, RotateCcw, Check } from 'lucide-react';
import ProtectedRoute from '@/components/ProtectedRoute';
import { useAuth } from '@/contexts/AuthContext';
import { ApiClient } from '@/lib/api-client';
import { LoadoutChecklistBlock } from '@/components/assault/LoadoutChecklistBlock';

interface ChecklistItem {
  item_key: string;
  label: string;
  description: string | null;
  phase: string;
  sort_order: number;
}

interface Progress {
  item_key: string;
  checked_at: string;
}

const PHASE_ORDER = ['prep', 'pre_buff', 'launch', 'mid', 'end'];
const PHASE_LABELS: Record<string, string> = {
  prep: 'Prep (-120m → -10m)',
  pre_buff: 'Pre-Buff (-5m)',
  launch: 'Launch (0m)',
  mid: '+30m Refresh',
  end: '+50m Lock-in',
};

function ChecklistInner() {
  const { currentGuild } = useAuth();
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [launchDate, setLaunchDate] = useState<string>('');
  const [loading, setLoading] = useState(true);

  const api = useMemo(() => {
    const c = new ApiClient();
    if (currentGuild) c.setGuildId(currentGuild.guild_id);
    return c;
  }, [currentGuild]);

  const load = useCallback(async () => {
    if (!currentGuild) return;
    setLoading(true);
    try {
      const res = await api.fetch('/api/assault/checklist');
      const json = await res.json();
      if (res.ok) {
        setItems(json.items ?? []);
        setChecked(new Set((json.progress ?? []).map((p: Progress) => p.item_key)));
        setLaunchDate(json.launch_date ?? '');
      }
    } finally {
      setLoading(false);
    }
  }, [api, currentGuild]);

  useEffect(() => { load(); }, [load]);

  const toggle = async (item_key: string) => {
    const nowChecked = !checked.has(item_key);
    const next = new Set(checked);
    if (nowChecked) next.add(item_key); else next.delete(item_key);
    setChecked(next);
    await api.fetch('/api/assault/checklist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_key, checked: nowChecked }),
    });
  };

  const reset = async () => {
    await api.fetch('/api/assault/checklist/reset', { method: 'POST' });
    setChecked(new Set());
  };

  const grouped = useMemo(() => {
    const g: Record<string, ChecklistItem[]> = {};
    for (const it of items) {
      (g[it.phase] ??= []).push(it);
    }
    for (const k in g) g[k].sort((a, b) => a.sort_order - b.sort_order);
    return g;
  }, [items]);

  const total = items.length;
  const doneCount = items.filter((i) => checked.has(i.item_key)).length;

  return (
    <div className="container mx-auto p-4 max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link href="/assault"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" />Assault</Button></Link>
          <h1 className="text-2xl font-bold">Checklist</h1>
        </div>
        <Button variant="outline" size="sm" onClick={reset}><RotateCcw className="h-4 w-4 mr-1" />Reset</Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base">
            <span>{currentGuild?.guild_name ?? 'Guild'}</span>
            <span className="text-sm font-normal text-muted-foreground">
              {doneCount}/{total} done · Launch {launchDate || '—'}
            </span>
          </CardTitle>
          <CardDescription>Persists until next launch. Reset wipes current.</CardDescription>
        </CardHeader>
      </Card>

      <LoadoutChecklistBlock />

      {loading && <Loader2 className="h-5 w-5 animate-spin" />}

      {PHASE_ORDER.filter((p) => grouped[p]?.length).map((phase) => (
        <Card key={phase}>
          <CardHeader>
            <CardTitle className="text-base">{PHASE_LABELS[phase] ?? phase}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {grouped[phase].map((it) => {
              const isChecked = checked.has(it.item_key);
              return (
                <button
                  key={it.item_key}
                  type="button"
                  onClick={() => toggle(it.item_key)}
                  className="flex items-start gap-3 py-1 w-full text-left cursor-pointer hover:bg-accent/40 rounded px-1"
                >
                  <span
                    className={`mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded border ${
                      isChecked ? 'bg-orange-500 border-orange-500 text-white' : 'border-input'
                    }`}
                  >
                    {isChecked && <Check className="h-3.5 w-3.5" />}
                  </span>
                  <span className="flex-1">
                    <span className={`block ${isChecked ? 'line-through text-muted-foreground' : ''}`}>{it.label}</span>
                    {it.description && (
                      <span className="block text-xs text-muted-foreground">{it.description}</span>
                    )}
                  </span>
                </button>
              );
            })}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function ChecklistPage() {
  return (
    <ProtectedRoute requiredRole="MEMBER">
      <ChecklistInner />
    </ProtectedRoute>
  );
}
