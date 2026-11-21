'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, Loader2, Crown, Trophy } from 'lucide-react';
import { DREAM_BADGE_URL } from '@/lib/dream-badge';

interface Finish {
  zone_id: number; zone_name: string; season_number: number; guild_id: number; guild_name: string;
  position: number; of: number; kills: number; experience: number; image_url?: string | null;
}
interface Assaulter {
  key: string; name: string; total_level: number | null; guild_name: string;
  kills: number; experience: number; zones: number; seasons: number;
}
interface Payload {
  finishes: Finish[]; assaulters: Assaulter[];
  biggest_wave: { zone_name: string; season_number: number | null; starts_at: string; total_experience: number; total_kills: number } | null;
  error?: string;
}

type View = 'best' | 'all' | 'location';

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};
const compact = (n: number) => Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
const tone = (p: number) => p === 1 ? 'border-amber-500/70' : p === 2 ? 'border-slate-400/60' : p === 3 ? 'border-amber-700/60' : '';
const label = (p: number) => p === 1 ? 'text-amber-500' : p === 2 ? 'text-slate-300' : p === 3 ? 'text-amber-600' : 'text-foreground';

function FinishCard({ f }: { f: Finish }) {
  return (
    <Link href={`/assault/conquest?season=${f.season_number}&zone=${f.zone_id}`}>
      <div className={`group relative overflow-hidden rounded-xl border bg-card h-full hover:border-orange-500/60 transition ${tone(f.position)}`}>
        {f.image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={f.image_url} alt="" className="absolute inset-0 h-full w-full object-cover opacity-25 group-hover:opacity-35 transition" loading="lazy" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-card via-card/70 to-card/20" />
        <div className="relative p-3 flex flex-col h-full min-h-[104px]">
          <div className="text-xs font-medium truncate">{f.zone_name}</div>
          <div className={`mt-auto text-3xl font-bold leading-none ${label(f.position)}`}>
            {ordinal(f.position)}<span className="text-xs font-normal text-muted-foreground"> /{f.of}</span>
          </div>
          <div className="text-[11px] text-muted-foreground mt-1 flex justify-between">
            <span>Season {f.season_number}</span>
            <span className="tabular-nums">{compact(f.experience)} XP</span>
          </div>
          <div className="text-[10px] text-muted-foreground/80 truncate">{f.guild_name}</div>
        </div>
      </div>
    </Link>
  );
}

function PodiumSpot({ a, place }: { a: Assaulter; place: 1 | 2 | 3 }) {
  const medal = ['🥇', '🥈', '🥉'][place - 1];
  const height = place === 1 ? 'pt-6 pb-5' : place === 2 ? 'pt-4 pb-4' : 'pt-3 pb-3';
  return (
    <div className={`rounded-xl border bg-card text-center px-3 ${height} ${tone(place)} ${place === 1 ? 'order-2 md:-mt-3' : place === 2 ? 'order-1' : 'order-3'}`}>
      <div className="text-3xl">{medal}</div>
      <div className="font-bold text-lg leading-tight mt-1 truncate">{a.name}</div>
      <div className="text-xs text-muted-foreground">{a.total_level ? `Lv ${a.total_level} · ` : ''}{a.guild_name}</div>
      <div className={`text-2xl font-bold mt-2 ${label(place)}`}>{compact(a.experience)}<span className="text-xs font-normal text-muted-foreground"> XP</span></div>
      <div className="text-[11px] text-muted-foreground">{a.kills.toLocaleString()} kills · {a.seasons} season{a.seasons === 1 ? '' : 's'}</div>
    </div>
  );
}

export default function HallOfFamePage() {
  const [data, setData] = useState<Payload | null>(null);
  const [view, setView] = useState<View>('best');
  const [zoneFilter, setZoneFilter] = useState<string>('all');

  useEffect(() => {
    fetch('/api/assault/hall-of-fame').then(r => r.json()).then(setData).catch(() => setData({ finishes: [], assaulters: [], biggest_wave: null, error: 'Failed to load' }));
  }, []);

  const best = useMemo(() => {
    const m = new Map<number, Finish>();
    for (const f of data?.finishes ?? []) {
      const c = m.get(f.zone_id);
      if (!c || f.position < c.position || (f.position === c.position && f.experience > c.experience)) m.set(f.zone_id, f);
    }
    return Array.from(m.values()).sort((a, b) => a.position - b.position || b.experience - a.experience);
  }, [data]);

  const zones = useMemo(() => {
    const m = new Map<number, string>();
    for (const f of data?.finishes ?? []) m.set(f.zone_id, f.zone_name);
    return Array.from(m.entries()).sort((a, b) => a[0] - b[0]);
  }, [data]);

  const allSorted = useMemo(() =>
    (data?.finishes ?? [])
      .filter(f => zoneFilter === 'all' || String(f.zone_id) === zoneFilter)
      .sort((a, b) => a.position - b.position || b.season_number - a.season_number),
  [data, zoneFilter]);

  const byLocation = useMemo(() => {
    const m = new Map<number, { name: string; image: string | null | undefined; rows: Finish[] }>();
    for (const f of data?.finishes ?? []) {
      const g = m.get(f.zone_id) ?? { name: f.zone_name, image: f.image_url, rows: [] };
      g.rows.push(f);
      m.set(f.zone_id, g);
    }
    return Array.from(m.entries()).sort((a, b) => a[0] - b[0]).map(([id, g]) => ({ id, ...g, rows: g.rows.sort((a, b) => b.season_number - a.season_number) }));
  }, [data]);

  const [p1, p2, p3] = data?.assaulters ?? [];

  return (
    <div className="container mx-auto p-4 max-w-5xl space-y-8">
      <div className="flex items-center gap-2">
        <Link href="/assault"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" />Assault</Button></Link>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={DREAM_BADGE_URL} alt="" className="h-9 w-9 object-contain" />
        <div>
          <h1 className="text-2xl font-bold">Hall of Fame</h1>
          <p className="text-sm text-muted-foreground">Our best conquest finishes and all-time top assaulters.</p>
        </div>
      </div>

      {!data && <Loader2 className="h-5 w-5 animate-spin" />}
      {data?.error && <p className="text-sm text-destructive">{data.error}</p>}

      {data && !data.error && (
        <>
          {/* Finishes */}
          <section className="space-y-3">
            <div className="flex items-end justify-between gap-3 flex-wrap">
              <div>
                <h2 className="text-lg font-semibold flex items-center gap-2"><Crown className="h-5 w-5 text-amber-500" />Finishes</h2>
                <p className="text-xs text-muted-foreground">Placements per location and season. Click a card to see the full ranking.</p>
              </div>
              <Tabs value={view} onValueChange={v => setView(v as View)}>
                <TabsList>
                  <TabsTrigger value="best">Best</TabsTrigger>
                  <TabsTrigger value="all">All finishes</TabsTrigger>
                  <TabsTrigger value="location">By location</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            {data.finishes.length === 0 && <p className="text-sm text-muted-foreground">No finishes stored yet. Run the backfill.</p>}

            {view === 'best' && (
              <div className="grid gap-2.5 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
                {best.map(f => <FinishCard key={f.zone_id} f={f} />)}
              </div>
            )}

            {view === 'all' && (
              <Card>
                <CardHeader className="pb-2">
                  <select
                    className="border rounded px-2 py-1 text-sm bg-background w-fit"
                    value={zoneFilter}
                    onChange={e => setZoneFilter(e.target.value)}
                  >
                    <option value="all">All locations</option>
                    {zones.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                  </select>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-muted-foreground text-xs">
                      <tr>
                        <th className="text-left py-1 w-16">Place</th>
                        <th className="text-left py-1">Location</th>
                        <th className="text-left py-1 hidden sm:table-cell">Guild</th>
                        <th className="text-right py-1">Season</th>
                        <th className="text-right py-1">XP</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allSorted.map(f => (
                        <tr key={`${f.season_number}-${f.zone_id}-${f.guild_id}`} className="border-t">
                          <td className={`py-1.5 font-semibold tabular-nums ${label(f.position)}`}>{ordinal(f.position)}<span className="text-xs font-normal text-muted-foreground">/{f.of}</span></td>
                          <td className="py-1.5">
                            <Link href={`/assault/conquest?season=${f.season_number}&zone=${f.zone_id}`} className="hover:underline">{f.zone_name}</Link>
                          </td>
                          <td className="py-1.5 hidden sm:table-cell text-muted-foreground">{f.guild_name}</td>
                          <td className="py-1.5 text-right tabular-nums">S{f.season_number}</td>
                          <td className="py-1.5 text-right tabular-nums">{compact(f.experience)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                </CardContent>
              </Card>
            )}

            {view === 'location' && (
              <div className="grid gap-3 md:grid-cols-2">
                {byLocation.map(loc => (
                  <Card key={loc.id} className="overflow-hidden">
                    <div className="relative h-12 bg-muted">
                      {loc.image && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={loc.image} alt="" className="absolute inset-0 h-full w-full object-cover opacity-50" loading="lazy" />
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-card to-transparent" />
                      <div className="absolute bottom-1 left-3 font-semibold">{loc.name}</div>
                    </div>
                    <CardContent className="pt-3 flex flex-wrap gap-1.5">
                      {loc.rows.map(f => (
                        <Link key={`${f.season_number}-${f.guild_id}`} href={`/assault/conquest?season=${f.season_number}&zone=${f.zone_id}`}>
                          <Badge variant="secondary" className={`font-normal gap-1 hover:bg-secondary/70 ${f.position <= 3 ? tone(f.position) : ''}`}>
                            <span className="opacity-60">S{f.season_number}</span>
                            <strong className={label(f.position)}>{ordinal(f.position)}</strong>/{f.of}
                          </Badge>
                        </Link>
                      ))}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </section>

          {/* All-time assaulters */}
          <section className="space-y-3">
            <div>
              <h2 className="text-lg font-semibold flex items-center gap-2"><Trophy className="h-5 w-5 text-amber-500" />All-time Dream assaulters</h2>
              <p className="text-xs text-muted-foreground">Total XP across every stored season and location.</p>
            </div>
            {data.assaulters.length === 0 ? (
              <p className="text-sm text-muted-foreground">No member data yet.</p>
            ) : (
              <>
                <div className="grid gap-3 md:grid-cols-3 items-end">
                  {p1 && <PodiumSpot a={p1} place={1} />}
                  {p2 && <PodiumSpot a={p2} place={2} />}
                  {p3 && <PodiumSpot a={p3} place={3} />}
                </div>
                {data.assaulters.length > 3 && (
                  <details>
                    <summary className="text-sm text-muted-foreground cursor-pointer">Top 10</summary>
                    <ol start={4} className="mt-2 text-sm space-y-1">
                      {data.assaulters.slice(3).map((a, i) => (
                        <li key={a.key} className="flex justify-between gap-2 border-t pt-1">
                          <span><span className="text-muted-foreground w-6 inline-block">{i + 4}.</span>{a.name} <span className="text-xs text-muted-foreground">{a.guild_name}</span></span>
                          <span className="tabular-nums">{compact(a.experience)} XP</span>
                        </li>
                      ))}
                    </ol>
                  </details>
                )}
                <p className="text-xs text-muted-foreground">
                  <Link href="/assault/leaderboard" className="underline">Full leaderboard →</Link>
                </p>
              </>
            )}
          </section>

          {data.biggest_wave && (
            <section>
              <Card>
                <CardHeader className="pb-1">
                  <CardTitle className="text-base">Biggest wave</CardTitle>
                  <CardDescription>
                    {data.biggest_wave.zone_name}{data.biggest_wave.season_number ? ` · Season ${data.biggest_wave.season_number}` : ''} · {new Date(data.biggest_wave.starts_at).toLocaleDateString()}
                  </CardDescription>
                </CardHeader>
                <CardContent className="text-2xl font-bold">
                  {compact(data.biggest_wave.total_experience)} XP
                  <span className="text-sm font-normal text-muted-foreground"> · {data.biggest_wave.total_kills.toLocaleString()} kills</span>
                </CardContent>
              </Card>
            </section>
          )}
        </>
      )}
    </div>
  );
}
