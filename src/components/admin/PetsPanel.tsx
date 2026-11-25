'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, PawPrint, Trash2 } from 'lucide-react';
import { useApiClient } from '@/lib/api-client';
import { PET_QUALITIES, type CustomPet, type CustomPetStats } from '@/lib/combat/custom-pets';
import type { PetHuntEstimate } from '@/lib/combat/pet-hunting';

type Row = CustomPet & { hunt: PetHuntEstimate | null };

const STAT_LABELS: [keyof CustomPetStats, string][] = [
  ['agility', 'Agility'],
  ['moveSpeed', 'Movement speed'],
  ['stamina', 'Max stamina'],
  ['accuracy', 'Accuracy'],
  ['protection', 'Protection'],
  ['attackPower', 'Attack power'],
  ['maxHealth', 'Max health'],
  ['critChance', 'Crit chance'],
  ['critDamage', 'Crit damage'],
];

function StatsTable({ stats }: { stats: CustomPetStats }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-xs">
      {STAT_LABELS.map(([k, label]) => (
        <div key={k} className="flex justify-between gap-2">
          <span className="text-muted-foreground">{label}</span>
          <span className="tabular-nums">
            {stats[k].base}
            {stats[k].perLevel ? ` +${stats[k].perLevel}/lv` : ''}
          </span>
        </div>
      ))}
    </div>
  );
}

const huntLine = (h: PetHuntEstimate | null) =>
  h ? `Lv 100, mastery 100: ${h.agility} agility · ${h.moveSpeed} MS · ${h.maxStamina} stamina · ≈${h.citadelEncounters} encounters per hunt (Citadel est.)` : 'No hunting estimate';

/** Admin → System → Pets: add pets the code doesn't know yet by pasting the in-game stats panel. */
export default function PetsPanel() {
  const api = useApiClient();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [name, setName] = useState('');
  const [quality, setQuality] = useState<string>('Epic');
  const [paste, setPaste] = useState('');
  const [preview, setPreview] = useState<{ pet: CustomPet; hunt: PetHuntEstimate | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api.get('/api/admin/pets');
    const data = await res.json();
    if (res.ok) setRows(data.pets);
    else setError(data.error ?? 'Failed to load');
  }, [api]);
  useEffect(() => { load(); }, [load]);

  const submit = async (previewOnly: boolean) => {
    setBusy(true);
    setError(null);
    const res = await api.post('/api/admin/pets', { name, quality, paste, preview: previewOnly });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) return setError(data.error ?? 'Failed');
    if (previewOnly) setPreview(data);
    else {
      setPreview(null);
      setName('');
      setPaste('');
      load();
    }
  };

  const remove = async (pet: string) => {
    if (!confirm(`Remove ${pet}? Rosters and /combat stop recognising it.`)) return;
    await api.fetch(`/api/admin/pets?name=${encodeURIComponent(pet)}`, { method: 'DELETE' });
    load();
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><PawPrint className="h-5 w-5" />Add a pet</CardTitle>
          <CardDescription>
            For pets the site doesn&apos;t know yet (new or event pets). Paste the Stats block from the in-game pet page
            (Agility, +0.45, Per Level, 3, …). The pet then works on the Assault Roster, in hunting estimates and on /combat.
            Event pets drain stamina like Epic and show as their own tier.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            <Input className="w-48" placeholder="Pet name (e.g. Gromley)" value={name} onChange={(e) => setName(e.target.value)} />
            <select
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={quality}
              onChange={(e) => setQuality(e.target.value)}
            >
              {PET_QUALITIES.map((q) => <option key={q} value={q}>{q}</option>)}
            </select>
          </div>
          <Textarea rows={8} placeholder={'Stats\nAgility\n+0.45\nPer Level\n3\n…'} value={paste} onChange={(e) => setPaste(e.target.value)} />
          {error && <p className="text-sm text-red-500">{error}</p>}
          {preview && (
            <div className="rounded-md border p-3 space-y-2">
              <StatsTable stats={preview.pet.stats} />
              <p className="text-xs text-muted-foreground">{huntLine(preview.hunt)}</p>
            </div>
          )}
          <div className="flex gap-2">
            <Button variant="outline" disabled={busy || !name || !paste} onClick={() => submit(true)}>Preview</Button>
            <Button disabled={busy || !name || !paste} onClick={() => submit(false)}>
              {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Save pet
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Added pets</CardTitle>
          <CardDescription>Built-in pets live in code and aren&apos;t listed here.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!rows ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">None yet.</p>
          ) : (
            rows.map((r) => (
              <div key={r.name} className="rounded-md border p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{r.name}</span>
                    <Badge variant="outline">{r.quality}</Badge>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => remove(r.name)}><Trash2 className="h-4 w-4" /></Button>
                </div>
                <StatsTable stats={r.stats} />
                <p className="text-xs text-muted-foreground">{huntLine(r.hunt)}</p>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
