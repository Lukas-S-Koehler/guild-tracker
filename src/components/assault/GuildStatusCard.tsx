'use client';

import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export interface StatusValue {
  active: boolean;
  launch_time_utc: string; // HH:MM:SS
  skip_date: string | null;
  paused_until: string | null;
}

function utcHHMMToLocalPreview(utcHHMM: string): string {
  const [h, m] = utcHHMM.split(':').map(Number);
  const d = new Date();
  d.setUTCHours(h, m, 0, 0);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function todayLaunchUnix(utcHHMM: string): number {
  const [h, m] = utcHHMM.split(':').map(Number);
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, m, 0));
  return Math.floor(d.getTime() / 1000);
}

export default function GuildStatusCard({
  value,
  onSave,
}: {
  value: StatusValue;
  onSave: (v: Partial<StatusValue>) => Promise<void>;
}) {
  const hhmm = value.launch_time_utc.slice(0, 5);
  const [launchHHMM, setLaunchHHMM] = useState(hhmm);
  const [active, setActive] = useState(value.active);
  const [saving, setSaving] = useState(false);
  const [now, setNow] = useState<number>(() => Math.floor(Date.now() / 1000));

  useEffect(() => setLaunchHHMM(value.launch_time_utc.slice(0, 5)), [value.launch_time_utc]);
  useEffect(() => setActive(value.active), [value.active]);

  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  const launchUnix = todayLaunchUnix(launchHHMM);
  const effUnix = launchUnix < now ? launchUnix + 86400 : launchUnix;
  const diff = effUnix - now;
  const hh = Math.floor(diff / 3600);
  const mm = Math.floor((diff % 3600) / 60);
  const ss = diff % 60;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant={active ? 'default' : 'secondary'}>{active ? '🟢 Active' : '⏸️ Paused'}</Badge>
          {value.skip_date && <Badge variant="outline">Skip {value.skip_date}</Badge>}
        </div>
        <Button
          size="sm"
          variant={active ? 'outline' : 'default'}
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            try {
              await onSave({ active: !active });
              setActive(!active);
            } finally { setSaving(false); }
          }}
        >
          {active ? 'Pause' : 'Activate'}
        </Button>
      </div>

      <div>
        <Label>Launch Time (UTC)</Label>
        <div className="flex gap-2 items-center">
          <Input
            type="time"
            value={launchHHMM}
            onChange={e => setLaunchHHMM(e.target.value)}
            className="w-32"
          />
          <Button
            size="sm"
            disabled={saving || launchHHMM === hhmm}
            onClick={async () => {
              setSaving(true);
              try { await onSave({ launch_time_utc: `${launchHHMM}:00` }); } finally { setSaving(false); }
            }}
          >
            Save
          </Button>
          <span className="text-xs text-muted-foreground">
            Local: {utcHHMMToLocalPreview(launchHHMM)}
          </span>
        </div>
        <p className="text-xs mt-1">
          Next launch in <span className="font-mono">{hh}h {mm}m {ss}s</span>
          {' '}(<code>&lt;t:{effUnix}:R&gt;</code>)
        </p>
      </div>

      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            try {
              const today = new Date().toISOString().slice(0, 10);
              await onSave({ skip_date: value.skip_date === today ? null : today });
            } finally { setSaving(false); }
          }}
        >
          {value.skip_date === new Date().toISOString().slice(0, 10) ? 'Unskip Today' : 'Skip Today'}
        </Button>
      </div>
    </div>
  );
}
