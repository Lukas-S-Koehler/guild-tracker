'use client';

import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, ExternalLink } from 'lucide-react';

const HITS_TO_KILL = [
  { hits: 2, time: '3.00s', kills: '10,800' },
  { hits: 3, time: '4.53s', kills: '7,152' },
  { hits: 4, time: '6.18s', kills: '5,243' },
  { hits: 5, time: '7.23s', kills: '4,481' },
];

const ISLE_ENEMIES = [
  { name: 'Basilisk', level: 92, gph: 12113 },
  { name: 'Werewolf', level: 99, gph: 3349 },
  { name: 'Earth Elemental', level: 98, gph: 3331 },
  { name: 'Griffon', level: 94, gph: 1396 },
];

export default function AssaultGuidePage() {
  return (
    <div className="container mx-auto p-4 max-w-4xl space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/assault"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" />Assault</Button></Link>
        <h1 className="text-2xl font-bold">Assault Guide</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>🏝️ Isle of Whispers (Lv 92–99)</CardTitle>
          <CardDescription>On-site shrine. Daily 1h active wave + 8h POTG idle stack.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>Stockpile <strong>4,000–10,000+ mobs</strong> (+10–20% flee buffer). Hunting pet Lv 92+ required to auto-hunt here.</p>
          <div>
            <div className="font-semibold mb-1">Kill priority (gold/hr)</div>
            <ol className="list-decimal pl-5 space-y-0.5">
              {ISLE_ENEMIES.map((e) => (
                <li key={e.name}>
                  <strong>{e.name}</strong> (Lv {e.level}) — {e.gph.toLocaleString()} g/h
                </li>
              ))}
            </ol>
            <p className="text-muted-foreground mt-1">
              Basilisk is lowest level AND highest gold. Prioritize it. Scale up only if hits-to-kill stays low.
            </p>
          </div>
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

      <Card>
        <CardHeader>
          <CardTitle>⚔️ Efficient Combat Start (New / F2P)</CardTitle>
          <CardDescription>Patience &gt; raw combat level.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <ul className="list-disc pl-5 space-y-1">
            <li>First 24–48h: mine coal on main (combat spec) + first alt. Secondary STR/DEF exp + gold for consumables.</li>
            <li>Gear every ~10 levels up to 70 — market, don&apos;t craft.</li>
            <li>Hunt + Power Hunt for first mobs. Can drop active play later.</li>
            <li>Pet mastery: Zephyrix / Wrex premium. PM Lv 100 = 10 battle + 10 hunting pets.</li>
            <li>Stat priority: <Badge variant="outline">STR 40</Badge> <Badge variant="outline">DEX 30</Badge> <Badge variant="outline">DEF 30</Badge> <Badge variant="outline">SPD 20</Badge></li>
            <li>2–3 hit rule — lower maps until food cost stays below loot.</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
