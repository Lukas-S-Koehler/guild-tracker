'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Loader2, Trophy } from 'lucide-react';

interface RunRow {
  id: string;
  guild_id: string;
  season_number: number | null;
  total_kills: number;
  total_experience: number;
  starts_at: string;
  zone_name: string;
}

interface LBEntry {
  character_id: number;
  character_name: string;
  total_level: number | null;
  kills: number;
  experience: number;
  runs: number;
  guild_id: string;
}

export default function AssaultStatsPage() {
  const [data, setData] = useState<{ runs: RunRow[]; leaderboard: LBEntry[]; guild_totals: Record<string, { kills: number; experience: number; runs: number }>; seasons: number[] } | null>(null);
  const [season, setSeason] = useState<string>('all');
  const [guild, setGuild] = useState<string>('all');

  useEffect(() => {
    const qs = new URLSearchParams();
    if (season !== 'all') qs.set('season', season);
    if (guild !== 'all') qs.set('guild_id', guild);
    fetch(`/api/assault/stats?${qs.toString()}`)
      .then((r) => r.json())
      .then(setData);
  }, [season, guild]);

  const guildOpts = useMemo(() => {
    if (!data) return [] as string[];
    return Array.from(new Set(data.runs.map((r) => r.guild_id)));
  }, [data]);

  return (
    <div className="container mx-auto p-4 max-w-5xl space-y-4">
      <div className="flex items-center gap-2">
        <Link href="/assault"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" />Assault</Button></Link>
        <h1 className="text-2xl font-bold">Assault Stats</h1>
      </div>

      <div className="flex gap-2 flex-wrap text-sm">
        <select
          className="border rounded px-2 py-1 bg-background"
          value={season}
          onChange={(e) => setSeason(e.target.value)}
        >
          <option value="all">All seasons</option>
          {data?.seasons.map((s) => (
            <option key={s} value={s}>Season {s}</option>
          ))}
        </select>
        <select
          className="border rounded px-2 py-1 bg-background"
          value={guild}
          onChange={(e) => setGuild(e.target.value)}
        >
          <option value="all">All guilds</option>
          {guildOpts.map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
        </select>
      </div>

      {!data && <Loader2 className="h-5 w-5 animate-spin" />}

      {data && (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            {Object.entries(data.guild_totals).map(([gid, t]) => (
              <Card key={gid}>
                <CardHeader>
                  <CardTitle className="text-base">{gid}</CardTitle>
                  <CardDescription>{t.runs} runs</CardDescription>
                </CardHeader>
                <CardContent className="text-sm space-y-1">
                  <div>Kills: <strong>{t.kills.toLocaleString()}</strong></div>
                  <div>XP: <strong>{t.experience.toLocaleString()}</strong></div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><Trophy className="h-4 w-4" />Top Contributors</CardTitle>
              <CardDescription>Aggregated across all finalized runs in filter.</CardDescription>
            </CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="text-left py-1">#</th>
                    <th className="text-left py-1">Character</th>
                    <th className="text-left py-1">Guild</th>
                    <th className="text-right py-1">Kills</th>
                    <th className="text-right py-1">XP</th>
                    <th className="text-right py-1">Runs</th>
                  </tr>
                </thead>
                <tbody>
                  {data.leaderboard.map((e, i) => (
                    <tr key={`${e.guild_id}-${e.character_id}`} className="border-t">
                      <td className="py-1">{i + 1}</td>
                      <td className="py-1">
                        {e.character_name} {e.total_level && <Badge variant="outline" className="ml-1">Lv {e.total_level}</Badge>}
                      </td>
                      <td className="py-1 text-muted-foreground">{e.guild_id}</td>
                      <td className="py-1 text-right">{e.kills.toLocaleString()}</td>
                      <td className="py-1 text-right">{e.experience.toLocaleString()}</td>
                      <td className="py-1 text-right">{e.runs}</td>
                    </tr>
                  ))}
                  {data.leaderboard.length === 0 && (
                    <tr><td colSpan={6} className="py-3 text-center text-muted-foreground">No data yet.</td></tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent Runs</CardTitle>
            </CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="text-left py-1">Date</th>
                    <th className="text-left py-1">Guild</th>
                    <th className="text-left py-1">Zone</th>
                    <th className="text-right py-1">Kills</th>
                    <th className="text-right py-1">XP</th>
                    <th className="text-right py-1">Season</th>
                  </tr>
                </thead>
                <tbody>
                  {data.runs.slice(0, 50).map((r) => (
                    <tr key={r.id} className="border-t">
                      <td className="py-1">{new Date(r.starts_at).toLocaleDateString()}</td>
                      <td className="py-1">{r.guild_id}</td>
                      <td className="py-1">{r.zone_name}</td>
                      <td className="py-1 text-right">{r.total_kills.toLocaleString()}</td>
                      <td className="py-1 text-right">{r.total_experience.toLocaleString()}</td>
                      <td className="py-1 text-right">{r.season_number ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
