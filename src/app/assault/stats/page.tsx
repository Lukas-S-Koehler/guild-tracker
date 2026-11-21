'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Loader2, Trophy, Crown, Globe } from 'lucide-react';
import { DREAM_BADGE_URL } from '@/lib/dream-badge';

interface FieldEntry { position: number; guild_id: number; name: string; tag: string | null; experience: number; kills: number; ours: boolean }
interface ZoneStanding {
  zone_id: number; zone_name: string; image_url: string | null; position: number; of: number;
  kills: number; experience: number; field: FieldEntry[];
}
interface GuildStanding {
  guild_id: number; guild_name: string; guild_tag: string | null; note: string | null;
  overall_rank: number | null; of: number; experience: number; kills: number; zones: ZoneStanding[];
}
interface Finish { zone_id: number; zone_name: string; season_number: number; guild_name: string; position: number; of: number; experience: number }
interface Member { character_id: number; character_name: string; total_level: number | null; guild_id: number; kills: number; experience: number; zones: number }
interface Standings {
  current_season: number; season: number; seasons: number[]; snapshot_at: string | null;
  guilds: GuildStanding[]; best_finishes: Finish[]; members: Member[]; error?: string;
}

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};
const compact = (n: number) => Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);

function LocationCard({ z }: { z: ZoneStanding }) {
  const top = z.position === 1;
  return (
    <div className={`rounded-xl border overflow-hidden bg-card ${top ? 'border-amber-500/60' : ''}`}>
      <div className="relative h-20 bg-muted">
        {z.image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={z.image_url} alt="" className="absolute inset-0 h-full w-full object-cover opacity-60" loading="lazy" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-card via-card/40 to-transparent" />
        <div className="absolute bottom-2 left-3 right-3 flex items-end justify-between">
          <div className="font-semibold leading-tight">{z.zone_name}</div>
          <div className={`text-3xl font-bold leading-none ${top ? 'text-amber-500' : ''}`}>
            {ordinal(z.position)}<span className="text-xs font-normal text-muted-foreground"> /{z.of}</span>
          </div>
        </div>
      </div>
      <div className="p-3 space-y-2">
        <div className="flex gap-3 text-xs text-muted-foreground">
          <span><strong className="text-foreground">{compact(z.experience)}</strong> XP</span>
          <span><strong className="text-foreground">{compact(z.kills)}</strong> kills</span>
        </div>
        <ol className="text-xs space-y-0.5">
          {z.field.map(f => (
            <li key={f.guild_id} className={`flex items-center gap-1.5 ${f.ours ? 'font-semibold text-orange-400' : 'text-muted-foreground'}`}>
              <span className="w-6 tabular-nums">{ordinal(f.position)}</span>
              <span className="truncate flex-1">{f.name}</span>
              <span className="tabular-nums">{compact(f.experience)}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

export default function AssaultStatsPage() {
  const [season, setSeason] = useState<number | null>(null);
  const [data, setData] = useState<Standings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const qs = season ? `?season=${season}` : '';
    fetch(`/api/assault/standings${qs}`).then(r => r.json()).then((d: Standings) => { setData(d); setLoading(false); });
  }, [season]);

  const seasons = data ? Array.from(new Set([data.current_season, ...data.seasons])).sort((a, b) => b - a) : [];

  return (
    <div className="container mx-auto p-4 max-w-5xl space-y-6">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Link href="/assault"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" />Assault</Button></Link>
          <h1 className="text-2xl font-bold">Conquest Standing</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/assault/conquest"><Button variant="outline" size="sm"><Globe className="h-4 w-4 mr-1" />All locations</Button></Link>
          <Link href="/assault/leaderboard"><Button variant="outline" size="sm"><Trophy className="h-4 w-4 mr-1" />Leaderboard</Button></Link>
          <select
            className="border rounded px-2 py-1 text-sm bg-background"
            value={data?.season ?? ''}
            onChange={e => setSeason(parseInt(e.target.value, 10))}
          >
            {seasons.map(s => <option key={s} value={s}>Season {s}{s === data?.current_season ? ' (current)' : ''}</option>)}
          </select>
        </div>
      </div>

      {loading && <Loader2 className="h-5 w-5 animate-spin" />}
      {data?.error && <p className="text-sm text-destructive">{data.error}</p>}

      {data && !data.error && (
        <>
          {data.guilds.map(g => (
            <section key={g.guild_id} className="space-y-3">
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={DREAM_BADGE_URL} alt="" className="h-10 w-10 object-contain" />
                <div className="flex-1 min-w-0">
                  <h2 className="text-lg font-semibold leading-tight truncate">{g.guild_name}</h2>
                  <p className="text-xs text-muted-foreground">
                    {g.zones.length} location{g.zones.length === 1 ? '' : 's'} this season · {compact(g.experience)} XP total
                  </p>
                </div>
                {g.overall_rank && (
                  <Badge variant="secondary" className="font-normal">
                    Overall <strong className="ml-1">{ordinal(g.overall_rank)}</strong>/{g.of}
                  </Badge>
                )}
              </div>
              {g.zones.length === 0 ? (
                <Card><CardContent className="py-4 text-sm text-muted-foreground">{g.note ?? 'No zone data yet.'}</CardContent></Card>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {g.zones.map(z => <LocationCard key={z.zone_id} z={z} />)}
                </div>
              )}
            </section>
          ))}
          {data.snapshot_at && (
            <p className="text-xs text-muted-foreground -mt-3">Updated {new Date(data.snapshot_at).toLocaleString()}</p>
          )}

          {data.best_finishes.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base"><Crown className="h-4 w-4" />Best finishes</CardTitle>
                <CardDescription>Our best placement per location, across all stored seasons.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {data.best_finishes.slice(0, 12).map(b => (
                  <Badge key={b.zone_id} variant="secondary" className="gap-1 font-normal">
                    <strong>{ordinal(b.position)}</strong>/{b.of} {b.zone_name}
                    <span className="opacity-60">S{b.season_number}</span>
                  </Badge>
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><Trophy className="h-4 w-4" />Top assaulters — Season {data.season}</CardTitle>
              <CardDescription>Top 10 by XP. <Link href="/assault/leaderboard" className="underline">Full leaderboard →</Link></CardDescription>
            </CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="text-left py-1 w-8">#</th>
                    <th className="text-left py-1">Character</th>
                    <th className="text-right py-1">Kills</th>
                    <th className="text-right py-1">XP</th>
                    <th className="text-right py-1">Zones</th>
                  </tr>
                </thead>
                <tbody>
                  {data.members.slice(0, 10).map((m, i) => (
                    <tr key={m.character_id} className="border-t">
                      <td className="py-1">{i + 1}</td>
                      <td className="py-1">
                        {m.character_name}
                        {m.total_level ? <Badge variant="outline" className="ml-1 font-normal">Lv {m.total_level}</Badge> : null}
                      </td>
                      <td className="py-1 text-right tabular-nums">{m.kills.toLocaleString()}</td>
                      <td className="py-1 text-right tabular-nums">{m.experience.toLocaleString()}</td>
                      <td className="py-1 text-right tabular-nums">{m.zones}</td>
                    </tr>
                  ))}
                  {data.members.length === 0 && (
                    <tr><td colSpan={5} className="py-3 text-center text-muted-foreground">No member data yet.</td></tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
