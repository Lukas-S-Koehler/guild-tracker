'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, ExternalLink } from 'lucide-react';

const HITS_TO_KILL = [
  { hits: 2, time: '3.00s', kills: '10,800' },
  { hits: 3, time: '4.53s', kills: '7,152' },
  { hits: 4, time: '6.18s', kills: '5,243' },
  { hits: 5, time: '7.23s', kills: '4,481' },
];

const DEFAULT_ZONE = 'Isle of Whispers';

interface PlanEnemy {
  id: number;
  name: string;
  level: number;
  zone_name: string;
  gph: number;
  drop_count: number;
}

interface ZonePlanResponse {
  zone: string;
  enemies: PlanEnemy[];
  total_gph: number;
  level_min: number | null;
  level_max: number | null;
  shrine_info: string;
}

export default function AssaultGuidePage() {
  const [zones, setZones] = useState<string[]>([]);
  const [selectedZone, setSelectedZone] = useState<string>(DEFAULT_ZONE);
  const [plan, setPlan] = useState<ZonePlanResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch('/api/assault/plan/zones')
      .then((r) => r.json())
      .then((d) => setZones(d.zones ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedZone) return;
    setLoading(true);
    fetch(`/api/assault/plan?zone=${encodeURIComponent(selectedZone)}`)
      .then((r) => r.json())
      .then((d) => setPlan(d))
      .finally(() => setLoading(false));
  }, [selectedZone]);

  const levelRange =
    plan?.level_min != null && plan?.level_max != null
      ? plan.level_min === plan.level_max
        ? `Lv ${plan.level_min}`
        : `Lv ${plan.level_min}–${plan.level_max}`
      : '';

  return (
    <div className="container mx-auto p-4 max-w-4xl space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/assault"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" />Assault</Button></Link>
        <h1 className="text-2xl font-bold">Assault Guide</h1>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <CardTitle>🗺️ Zone Plan</CardTitle>
              <CardDescription>Kill priority by live gold/hr. Prices sync daily.</CardDescription>
            </div>
            <Select value={selectedZone} onValueChange={setSelectedZone}>
              <SelectTrigger className="w-[260px]"><SelectValue placeholder="Pick a zone" /></SelectTrigger>
              <SelectContent>
                {zones.map((z) => (<SelectItem key={z} value={z}>{z}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {loading && <p className="text-muted-foreground">Loading…</p>}
          {!loading && plan && plan.enemies.length === 0 && (
            <p className="text-muted-foreground">No enemies cached for this zone yet. Run <code>combat-enemies-sync</code>.</p>
          )}
          {!loading && plan && plan.enemies.length > 0 && (
            <>
              <div className="flex gap-3 flex-wrap text-xs text-muted-foreground">
                <span>{levelRange}</span>
                <span>· {plan.shrine_info}</span>
                <span>· Best: <strong className="text-foreground">{plan.total_gph.toLocaleString()} g/h</strong></span>
              </div>
              <p className="text-muted-foreground">
                Stockpile <strong>4,000–10,000+ mobs</strong> (+10–20% flee buffer). Hunting pet Lv {plan.level_min ?? '?'}+ required to auto-hunt here.
              </p>
              <div>
                <div className="font-semibold mb-1">Kill priority (gold/hr)</div>
                <ol className="list-decimal pl-5 space-y-0.5">
                  {plan.enemies.map((e) => (
                    <li key={e.id}>
                      <strong>{e.name}</strong> (Lv {e.level}) — {e.gph.toLocaleString()} g/h · {e.drop_count} drops
                    </li>
                  ))}
                </ol>
                <p className="text-muted-foreground mt-1">
                  Pick the lowest level × highest gold. Scale up only if hits-to-kill stays low.
                </p>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>⚡ The 5 Ps (Prep Sequence)</CardTitle>
          <CardDescription>Do these in order each launch.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <ol className="list-decimal pl-5 space-y-1">
            <li><strong>-120m</strong> — Pool live, hunt final mobs (4k–10k+)</li>
            <li><strong>-30m</strong> — Wrap hunting, clear inventory, pack food, check stance</li>
            <li><strong>-10m</strong> — Combat gear, battle pet patted, perks active, shrine active, XP pots staged. Do NOT drink POTG yet.</li>
            <li><strong>-5m</strong> — Wraithbane / Strike Essence + combat stat pot (Thunderfury / Bladeburst). POTG in hand.</li>
            <li><strong>0m</strong> — Chug POTG, select up to 6 mobs (lowest hits-to-kill), click Battle.</li>
            <li><strong>+30m</strong> — Restack stat pots if not already active.</li>
            <li><strong>+50m</strong> — Final 8h restack while POTG + Pool still up. Don&apos;t lose the snapshot.</li>
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>🎯 Hits-to-Kill Reference</CardTitle>
          <CardDescription>Target 2–3 hits for max throughput.</CardDescription>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead className="text-muted-foreground">
              <tr>
                <th className="text-left py-1">Hits</th>
                <th className="text-left py-1">Time / Kill</th>
                <th className="text-left py-1">Kills / 9h Window</th>
              </tr>
            </thead>
            <tbody>
              {HITS_TO_KILL.map((h) => (
                <tr key={h.hits} className="border-t">
                  <td className="py-1">{h.hits}</td>
                  <td className="py-1">{h.time}</td>
                  <td className="py-1">{h.kills}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>🛡️ Gear</CardTitle>
          <CardDescription>BiS3+ legendary recommended for Isle of Whispers.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm space-y-2">
          <p>Reference gear tiers and upgrades on the external tracker:</p>
          <a
            href="https://dungeon-tracker-seven.vercel.app/gear"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            dungeon-tracker-seven.vercel.app/gear <ExternalLink className="h-3 w-3" />
          </a>
          <p className="text-muted-foreground">Below Lv 70 just buy market gear. From Lv 90+ mythic gear & upgrade stones get expensive.</p>
        </CardContent>
      </Card>
    </div>
  );
}
