'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { DREAM_BADGE_URL } from '@/lib/dream-badge';

interface FieldEntry { position: number; guild_id: number; name: string; tag: string | null; experience: number; kills: number; ours: boolean; dream?: boolean }
interface Zone { zone_id: number; zone_name: string; image_url: string | null; guild_count: number; guilds: FieldEntry[] }
interface Payload { current_season: number; season: number; seasons: number[]; zones: Zone[]; error?: string }

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};
const compact = (n: number) => Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);

function Row({ f }: { f: FieldEntry }) {
  return (
    <tr className={`border-t ${f.ours ? 'bg-orange-500/10 font-semibold text-orange-400' : f.dream ? 'bg-sky-500/10 text-sky-300' : ''}`}>
      <td className="py-1 w-10 tabular-nums">{ordinal(f.position)}</td>
      <td className="py-1">
        {f.dream && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={DREAM_BADGE_URL} alt="Dream" className="inline h-4 w-4 object-contain mr-1 align-text-bottom" />
        )}{f.name}{f.tag ? <span className="text-xs text-muted-foreground ml-1">[{f.tag}]</span> : null}</td>
      <td className="py-1 text-right tabular-nums text-xs">{f.kills.toLocaleString()}</td>
      <td className="py-1 text-right tabular-nums">{compact(f.experience)}</td>
    </tr>
  );
}

export default function ConquestLocationsPage() {
  const [season, setSeason] = useState<number | null>(null);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [dreamOnly, setDreamOnly] = useState(false);

  // ?season=N&zone=ID deep link (e.g. from best finishes)
  const [focusZone, setFocusZone] = useState<number | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const sn = parseInt(q.get('season') ?? '', 10);
    const zn = parseInt(q.get('zone') ?? '', 10);
    if (sn) setSeason(sn);
    if (zn) setFocusZone(zn);
  }, []);

  useEffect(() => {
    if (!data || focusZone == null) return;
    document.getElementById(`zone-${focusZone}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [data, focusZone]);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/assault/conquest${season ? `?season=${season}` : ''}`).then(r => r.json()).then(setData).finally(() => setLoading(false));
  }, [season]);

  return (
    <div className="container mx-auto p-4 max-w-5xl space-y-5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Link href="/assault/stats"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" />Stats</Button></Link>
          <div>
            <h1 className="text-2xl font-bold">Conquest by Location</h1>
            <p className="text-sm text-muted-foreground">Guild rankings for every location. Our guilds are highlighted.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
        <Button variant={dreamOnly ? 'default' : 'outline'} size="sm" onClick={() => setDreamOnly(v => !v)}>
          Dream guilds only
        </Button>
        <select
          className="border rounded px-2 py-1 text-sm bg-background"
          value={data?.season ?? ''}
          onChange={e => setSeason(parseInt(e.target.value, 10))}
        >
          {data?.seasons.map(s => <option key={s} value={s}>Season {s}{s === data.current_season ? ' (current)' : ''}</option>)}
        </select>
        </div>
      </div>

      {loading && <Loader2 className="h-5 w-5 animate-spin" />}
      {data?.error && <p className="text-sm text-destructive">{data.error}</p>}
      {data && !data.error && data.zones.length === 0 && (
        <p className="text-sm text-muted-foreground">No standings stored for season {data.season} yet.</p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {data?.zones.filter(z => !dreamOnly || z.guilds.some(f => f.dream || f.ours)).map(z => {
          const top = z.guilds.slice(0, 10);
          const rest = z.guilds.slice(10);
          const oursInRest = rest.filter(f => f.ours);
          return (
            <Card key={z.zone_id} id={`zone-${z.zone_id}`} className={`overflow-hidden scroll-mt-20 ${focusZone === z.zone_id ? 'ring-2 ring-orange-500/60' : ''}`}>
              <div className="relative h-16 bg-muted">
                {z.image_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={z.image_url} alt="" className="absolute inset-0 h-full w-full object-cover opacity-50" loading="lazy" />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-card to-transparent" />
                <CardHeader className="absolute bottom-0 left-0 right-0 p-3 pb-2 flex-row items-end justify-between space-y-0">
                  <CardTitle className="text-base">{z.zone_name}</CardTitle>
                  <Badge variant="secondary" className="font-normal">{z.guild_count} guilds</Badge>
                </CardHeader>
              </div>
              <CardContent className="pt-2">
                <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <tbody>
                    {top.map(f => <Row key={f.guild_id} f={f} />)}
                    {oursInRest.map(f => <Row key={f.guild_id} f={f} />)}
                  </tbody>
                </table>
                </div>
                {rest.length > 0 && (
                  <details className="mt-1">
                    <summary className="text-xs text-muted-foreground cursor-pointer">Show all {z.guild_count}</summary>
                    <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <tbody>{rest.map(f => <Row key={f.guild_id} f={f} />)}</tbody>
                    </table>
                    </div>
                  </details>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
      <CardDescription className="text-xs">Columns: rank, guild, kills, XP. Orange = our assault guilds, blue = other Dream guilds.</CardDescription>
    </div>
  );
}
