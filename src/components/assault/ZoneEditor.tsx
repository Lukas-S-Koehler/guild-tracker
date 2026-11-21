'use client';

import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export interface Enemy { name: string; level: number; gold_per_hr: number }
export interface ZoneValue {
  zone_id: number | null;
  zone_name: string;
  level_range: string;
  shrine_info: string;
  target_mob_count: string;
  enemy_priority: Enemy[];
}

interface LocationOption { zone_id: number | null; zone: string; level_min: number | null; level_max: number | null; total_gph: number }

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
  onSave: (v: { zone_id?: number; target_mob_count?: string }) => Promise<void>;
}) {
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [zoneId, setZoneId] = useState<number | null>(value.zone_id);
  const [mobs, setMobs] = useState(value.target_mob_count);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setZoneId(value.zone_id); setMobs(value.target_mob_count); }, [value]);
  useEffect(() => {
    fetch('/api/assault/locations').then(r => r.json()).then(j => setLocations(j.locations ?? [])).catch(() => {});
  }, []);

  const changed = zoneId !== value.zone_id || mobs !== value.target_mob_count;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label>Location</Label>
          <select
            className="w-full border rounded px-2 py-2 text-sm bg-background"
            value={zoneId ?? ''}
            onChange={e => setZoneId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Select location…</option>
            {locations.map(l => (
              <option key={l.zone_id} value={l.zone_id ?? ''}>
                {l.zone} (Lv {l.level_min}–{l.level_max})
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground mt-1">
            Level range, shrine and gold-ranked enemies fill in automatically and refresh with market prices.
          </p>
        </div>
        <div>
          <Label>Target Mob Count</Label>
          <Input value={mobs} onChange={e => setMobs(e.target.value)} />
        </div>
      </div>

      <div className="border rounded p-3 bg-muted/20 space-y-2">
        <div className="flex items-center gap-2 flex-wrap text-sm">
          <strong>{value.zone_name || '—'}</strong>
          {value.level_range && <Badge variant="outline">Lv {value.level_range}</Badge>}
          {value.shrine_info && <Badge variant="secondary">{value.shrine_info}</Badge>}
        </div>
        <div className="space-y-1">
          {value.enemy_priority.map((e, i) => (
            <div key={`${e.name}-${i}`} className="flex items-center gap-2 text-sm">
              <span className="text-xs text-muted-foreground w-5">{i + 1}.</span>
              <span className="flex-1">{e.name}</span>
              <span className="text-muted-foreground text-xs">Lv {e.level}</span>
              <span className="w-24 text-right tabular-nums">{e.gold_per_hr.toLocaleString()} g/h</span>
            </div>
          ))}
          {value.enemy_priority.length === 0 && <p className="text-xs text-muted-foreground">No enemies yet — pick a location.</p>}
        </div>
      </div>

      <div className="border rounded p-3 bg-muted/20">
        <Label className="mb-2 block">Hits-to-Kill Reference</Label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
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
        disabled={saving || !changed || zoneId == null}
        onClick={async () => {
          setSaving(true);
          try {
            await onSave({
              ...(zoneId != null && zoneId !== value.zone_id ? { zone_id: zoneId } : {}),
              ...(mobs !== value.target_mob_count ? { target_mob_count: mobs } : {}),
            });
          } finally { setSaving(false); }
        }}
      >
        {saving ? 'Saving…' : 'Save Location'}
      </Button>
    </div>
  );
}
