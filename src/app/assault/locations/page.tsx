'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Loader2, MapPin, Coins, Landmark } from 'lucide-react';

interface Loot { name: string; quantity: number; chance: number; price: number; quality?: string; image_url?: string | null }
interface Enemy {
  id: number; name: string; level: number; health?: number; experience?: number; chance_of_loot?: number;
  image_url?: string | null; ev_per_kill: number; gph: number; loot: Loot[];
}
interface Location {
  image_url?: string | null; description?: string | null;
  weather?: { name: string; buffs: string[]; ends_at: string } | null;
  zone_id: number | null; zone: string; shrine?: boolean; enemies: Enemy[]; total_gph: number;
  level_min: number | null; level_max: number | null; priced_items?: number; total_items?: number; prices_updated_at?: string | null;
}

const compact = (n: number) => Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
const gold = (n: number) => (n >= 100 ? Math.round(n).toLocaleString() : n.toFixed(1));

export default function LocationsPage() {
  const [locations, setLocations] = useState<Location[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/assault/locations')
      .then(r => r.json())
      .then(j => (j.error ? setError(j.error) : setLocations(j.locations)))
      .catch(e => setError(String(e)));
  }, []);

  const updated = locations?.map(l => l.prices_updated_at).filter(Boolean).sort().pop();

  return (
    <div className="container mx-auto p-4 max-w-5xl space-y-5">
      <div className="flex items-center gap-2">
        <Link href="/assault"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" />Assault</Button></Link>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><MapPin className="h-6 w-6 text-orange-500" />Locations</h1>
          <p className="text-sm text-muted-foreground">
            Enemies and drops per conquest location. Gold/hour = expected drop value at 1,200 kills/h using market prices
            {updated ? ` (prices updated ${new Date(updated).toLocaleString()})` : ''}.
          </p>
        </div>
      </div>

      {!locations && !error && <Loader2 className="h-5 w-5 animate-spin" />}
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid gap-4">
        {locations?.map(loc => (
          <Card key={loc.zone_id ?? loc.zone}>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                {loc.image_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={loc.image_url} alt={loc.zone} className="h-16 w-16 rounded-lg object-cover border shrink-0" loading="lazy" />
                )}
                <div className="flex-1 min-w-[10rem]">
                  <CardTitle className="text-lg">{loc.zone}</CardTitle>
                  {loc.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{loc.description}</p>}
                  <CardDescription className="flex gap-1.5 flex-wrap mt-1">
                    <Badge variant="outline">Lv {loc.level_min}{loc.level_max !== loc.level_min ? `–${loc.level_max}` : ''}</Badge>
                    {loc.weather && (
                      <Badge variant="outline" className="font-normal" title={loc.weather.buffs.join(' · ')}>
                        ☁ {loc.weather.name}{loc.weather.buffs[0] ? ` · ${loc.weather.buffs[0]}` : ''}
                      </Badge>
                    )}
                    {loc.shrine && <Badge variant="secondary" className="gap-1"><Landmark className="h-3 w-3" />Shrine</Badge>}
                    {loc.total_items != null && loc.total_items > 0 && loc.priced_items! < loc.total_items && (
                      <Badge variant="outline" className="text-amber-500">{loc.total_items - loc.priced_items!} unpriced drops</Badge>
                    )}
                  </CardDescription>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold tabular-nums flex items-center gap-1 justify-end">
                    <Coins className="h-5 w-5 text-yellow-500" />{compact(loc.total_gph)}
                  </div>
                  <div className="text-xs text-muted-foreground">best gold / hour</div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead className="text-muted-foreground text-xs">
                  <tr>
                    <th className="text-left py-1 w-6">#</th>
                    <th className="text-left py-1">Enemy</th>
                    <th className="text-right py-1 hidden sm:table-cell">HP</th>
                    <th className="text-right py-1 hidden sm:table-cell">XP</th>
                    <th className="text-right py-1">EV/kill</th>
                    <th className="text-right py-1">Gold/h</th>
                  </tr>
                </thead>
                <tbody>
                  {loc.enemies.map((e, i) => (
                    <tr key={e.id} className="border-t align-top">
                      <td className="py-1.5 text-muted-foreground">{i + 1}</td>
                      <td className="py-1.5">
                        <details>
                          <summary className="cursor-pointer select-none list-none">
                            <span className={i === 0 ? 'font-semibold' : ''}>{e.name}</span>
                            <span className="text-xs text-muted-foreground ml-1.5">Lv {e.level}</span>
                            <span className="text-xs text-muted-foreground ml-1.5">· {e.loot.length} drops ▾</span>
                          </summary>
                          <ul className="mt-1 mb-1 pl-2 space-y-0.5 text-xs text-muted-foreground">
                            {e.chance_of_loot != null && <li>Loot roll chance: {e.chance_of_loot}%</li>}
                            {[...e.loot].sort((a, b) => b.chance * b.quantity * b.price - a.chance * a.quantity * a.price).map(l => (
                              <li key={l.name} className="flex gap-2 justify-between">
                                <span>{l.quantity}× {l.name} <span className="opacity-60">({l.chance}%)</span></span>
                                <span className="tabular-nums">{l.price > 0 ? `${l.price.toLocaleString()}g` : 'no price'}</span>
                              </li>
                            ))}
                          </ul>
                        </details>
                      </td>
                      <td className="py-1.5 text-right tabular-nums hidden sm:table-cell">{e.health?.toLocaleString() ?? '—'}</td>
                      <td className="py-1.5 text-right tabular-nums hidden sm:table-cell">{e.experience?.toLocaleString() ?? '—'}</td>
                      <td className="py-1.5 text-right tabular-nums">{gold(e.ev_per_kill)}</td>
                      <td className="py-1.5 text-right tabular-nums font-medium">{e.gph.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
