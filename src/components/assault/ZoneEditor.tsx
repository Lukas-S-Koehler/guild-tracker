'use client';

import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { ArrowUp, ArrowDown, Trash2, Plus } from 'lucide-react';

export interface Enemy { name: string; level: number; gold_per_hr: number }
export interface ZoneValue {
  zone_name: string;
  level_range: string;
  shrine_info: string;
  target_mob_count: string;
  enemy_priority: Enemy[];
}

const HITS_TO_KILL = [
  { hits: 2, seconds: 3.00, kills: 10800 },
  { hits: 3, seconds: 4.53, kills: 7152 },
  { hits: 4, seconds: 6.18, kills: 5243 },
  { hits: 5, seconds: 7.23, kills: 4481 },
];

export default function ZoneEditor({
  value,
  onSave,
}: {
  value: ZoneValue;
  onSave: (v: ZoneValue) => Promise<void>;
}) {
  const [draft, setDraft] = useState<ZoneValue>(value);
  const [saving, setSaving] = useState(false);

  useEffect(() => setDraft(value), [value]);

  const setEnemy = (i: number, patch: Partial<Enemy>) =>
    setDraft(d => ({
      ...d,
      enemy_priority: d.enemy_priority.map((e, idx) => idx === i ? { ...e, ...patch } : e),
    }));

  const move = (i: number, dir: -1 | 1) => {
    setDraft(d => {
      const arr = [...d.enemy_priority];
      const j = i + dir;
      if (j < 0 || j >= arr.length) return d;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      return { ...d, enemy_priority: arr };
    });
  };

  const remove = (i: number) =>
    setDraft(d => ({ ...d, enemy_priority: d.enemy_priority.filter((_, idx) => idx !== i) }));

  const add = () =>
    setDraft(d => ({ ...d, enemy_priority: [...d.enemy_priority, { name: '', level: 0, gold_per_hr: 0 }] }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Zone Name</Label>
          <Input value={draft.zone_name} onChange={e => setDraft(d => ({ ...d, zone_name: e.target.value }))} />
        </div>
        <div>
          <Label>Level Range</Label>
          <Input value={draft.level_range} onChange={e => setDraft(d => ({ ...d, level_range: e.target.value }))} />
        </div>
        <div>
          <Label>Shrine Status / Location</Label>
          <Input value={draft.shrine_info} onChange={e => setDraft(d => ({ ...d, shrine_info: e.target.value }))} />
        </div>
        <div>
          <Label>Target Mob Count</Label>
          <Input value={draft.target_mob_count} onChange={e => setDraft(d => ({ ...d, target_mob_count: e.target.value }))} />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <Label>Enemy Gold Priority</Label>
          <Button variant="outline" size="sm" onClick={add}><Plus className="h-3 w-3 mr-1" />Add</Button>
        </div>
        <div className="space-y-1">
          {draft.enemy_priority.map((e, i) => (
            <div key={i} className="flex items-center gap-2 border rounded p-2 bg-muted/30">
              <span className="text-xs text-muted-foreground w-6">{i + 1}.</span>
              <Input className="flex-1" placeholder="Name" value={e.name} onChange={ev => setEnemy(i, { name: ev.target.value })} />
              <Input className="w-16" type="number" placeholder="Lvl" value={e.level} onChange={ev => setEnemy(i, { level: Number(ev.target.value) })} />
              <Input className="w-24" type="number" placeholder="g/hr" value={e.gold_per_hr} onChange={ev => setEnemy(i, { gold_per_hr: Number(ev.target.value) })} />
              <Button size="sm" variant="ghost" onClick={() => move(i, -1)}><ArrowUp className="h-3 w-3" /></Button>
              <Button size="sm" variant="ghost" onClick={() => move(i, 1)}><ArrowDown className="h-3 w-3" /></Button>
              <Button size="sm" variant="ghost" onClick={() => remove(i)}><Trash2 className="h-3 w-3" /></Button>
            </div>
          ))}
          {draft.enemy_priority.length === 0 && (
            <p className="text-xs text-muted-foreground">No enemies — add one.</p>
          )}
        </div>
      </div>

      <div className="border rounded p-3 bg-muted/20">
        <Label className="mb-2 block">Hits-to-Kill Reference</Label>
        <div className="grid grid-cols-4 gap-2 text-xs">
          {HITS_TO_KILL.map(r => (
            <div key={r.hits} className="text-center border rounded p-1">
              <div className="font-semibold">{r.hits} hits</div>
              <div>{r.seconds.toFixed(2)}s</div>
              <div className="text-muted-foreground">{r.kills.toLocaleString()} kills</div>
            </div>
          ))}
        </div>
      </div>

      <Button
        disabled={saving}
        onClick={async () => {
          setSaving(true);
          try { await onSave(draft); } finally { setSaving(false); }
        }}
      >
        {saving ? 'Saving…' : 'Save Zone & Enemies'}
      </Button>
    </div>
  );
}
