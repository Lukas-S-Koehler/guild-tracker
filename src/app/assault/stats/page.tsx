'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Loader2, Trophy, Crown } from 'lucide-react';

interface ZoneStanding { zone_id: number; zone_name: string; position: number; of: number; kills: number; experience: number; leader: { name: string; experience: number } | null }
interface GuildStanding {
  guild_id: number; guild_name: string; guild_tag: string | null;
  overall_rank: number | null; of: number; experience: number; kills: number; zones: ZoneStanding[];
}
interface Finish { zone_id: number; zone_name: string; season_number: number; guild_name: string; position: number; of: number; experience: number }
interface Member { character_id: number; character_name: string; total_level: number | null; guild_id: number; kills: number; experience: number; zones: number }
interface Standings {
  current_season: number; season: number; seasons: number[]; snapshot_at: string | null;
  guilds: GuildStanding[]; best_finishes: Finish[]; members: Member[]; error?: string;
}
interface RunRow { id: string; guild_id: string; season_number: number | null; total_kills: number; total_experience: number; starts_at: string; zone_name: string; status: string }

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};
const compact = (n: number) => Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);

export default function AssaultStatsPage() {
  const [season, setSeason] = useState<number | null>(null);
  const [data, setData] = useState<Standings | null>(null);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const qs = season ? `?season=${season}` : '';
    fetch(`/api/assault/standings${qs}`).then(r => r.json()).then((d: Standings) => { setData(d); setLoading(false); });
  }, [season]);

  useEffect(() => {
    if (!data) return;
    fetch(`/api/assault/stats?season=${data.season}`).then(r => r.json()).then(d => setRuns(d.runs ?? []));
  }, [data?.season]); // eslint-disable-line react-hooks/exhaustive-deps

  const seasons = data ? Array.from(new Set([data.current_season, ...data.seasons])).sort((a, b) => b - a) : [];

  return (
    <div className="container mx-auto p-4 max-w-5xl space-y-5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Link href="/assault"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" />Assault</Button></Link>
          <h1 className="text-2xl font-bold">Conquest Standing</h1>
        </div>
        <select
          className="border rounded px-2 py-1 text-sm bg-background"
          value={data?.season ?? ''}
          onChange={e => setSeason(parseInt(e.target.value, 10))}
        >
          {seasons.map(s => (
            <option key={s} value={s}>Season {s}{s === data?.current_season ? ' (current)' : ''}</option>
          ))}
        </select>
      </div>

      {loading && <Loader2 className="h-5 w-5 animate-spin" />}
      {data?.error && <p className="text-sm text-destructive">{data.error}</p>}

      {data && !data.error && (
        <>
          {/* Hero: standing per guild */}
          <div className="grid gap-4 md:grid-cols-2">
            {data.guilds.map(g => (
              <Card key={g.guild_id} className="overflow-hidden">
                <CardHeader className="pb-2">
                  <CardDescription className="flex items-center gap-1">
                    {g.guild_name}{g.guild_tag && <span className="opacity-60">[{g.guild_tag}]</span>}
                  </CardDescription>
                  <div className="flex items-baseline gap-2">
                    <CardTitle className="text-5xl font-bold tracking-tight">
                      {g.overall_rank ? ordinal(g.overall_rank) : '—'}
                    </CardTitle>
                    <span className="text-muted-foreground text-sm">of {g.of} guilds · {compact(g.experience)} XP</span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-1.5 pt-2">
                  {g.zones.length === 0 && <p className="text-sm text-muted-foreground">No zone data yet.</p>}
                  {g.zones.map(z => (
                    <div key={z.zone_id} className="flex items-center gap-2 text-sm">
                      <span className={`w-9 text-right font-semibold tabular-nums ${z.position === 1 ? 'text-amber-500' : ''}`}>
                        {ordinal(z.position)}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="truncate">{z.zone_name}</div>
                        <div className="h-1 rounded bg-muted mt-0.5">
                          <div
                            className="h-1 rounded bg-primary/70"
                            style={{ width: `${Math.max(4, 100 - ((z.position - 1) / Math.max(1, z.of - 1)) * 100)}%` }}
                          />
                        </div>
                      </div>
                      <span className="text-muted-foreground tabular-nums text-xs w-20 text-right">{compact(z.experience)} XP</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
          {data.snapshot_at && (
            <p className="text-xs text-muted-foreground -mt-2">Updated {new Date(data.snapshot_at).toLocaleString()}</p>
          )}

          {/* Best finishes */}
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

          {/* Members */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><Trophy className="h-4 w-4" />Member standing — Season {data.season}</CardTitle>
              <CardDescription>Total XP across zones for our assault guilds.</CardDescription>
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
                  {data.members.map((m, i) => (
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

          {/* Run history, status subtle */}
          {runs.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Assault runs</CardTitle></CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <tbody>
                    {runs.slice(0, 30).map(r => (
                      <tr key={r.id} className="border-t first:border-0">
                        <td className="py-1 text-muted-foreground">{new Date(r.starts_at).toLocaleDateString()}</td>
                        <td className="py-1">{r.zone_name}</td>
                        <td className="py-1 text-right tabular-nums">{r.total_kills.toLocaleString()} kills</td>
                        <td className="py-1 text-right tabular-nums">{compact(r.total_experience)} XP</td>
                        <td className="py-1 text-right">
                          <span
                            title={r.status === 'finalized' ? 'Final' : 'In progress / interim'}
                            className={`inline-block h-2 w-2 rounded-full ${r.status === 'finalized' ? 'bg-emerald-500' : 'bg-amber-400'}`}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
