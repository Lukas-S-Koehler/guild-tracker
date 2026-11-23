'use client';

import { profilePath } from '@/lib/profile-path';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Copy, Check, ArrowLeft } from 'lucide-react';
import { formatGold, getRankEmoji, copyToClipboard } from '@/lib/utils';

type Sort = 'experience' | 'kills';

interface Entry {
  key: string;
  name: string;
  total_level: number | null;
  guild_id: number;
  guild_name: string;
  kills: number;
  experience: number;
  zones: number;
  seasons: number;
  alt_count: number;
  alt_names: string[];
}

interface Payload {
  current_season: number;
  seasons: number[];
  guilds: Array<{ id: number; name: string }>;
  entries: Entry[];
  error?: string;
}

export default function AssaultLeaderboardPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [season, setSeason] = useState<string>('current');
  const [guild, setGuild] = useState<string>('all');
  const [sort, setSort] = useState<Sort>('experience');
  const [merged, setMerged] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ merged: String(merged) });
    if (season !== 'current') params.set('season', season);
    if (guild !== 'all') params.set('guild', guild);
    fetch(`/api/assault/leaderboard?${params}`)
      .then(r => r.json())
      .then((d: Payload) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [season, guild, merged]);

  const entries = [...(data?.entries ?? [])].sort((a, b) => b[sort] - a[sort]);
  const seasonLabel = season === 'all' ? 'All Time' : `Season ${season === 'current' ? data?.current_season ?? '' : season}`;

  const handleCopy = async () => {
    const lines = entries.slice(0, 15).map((e, i) =>
      `${i + 1}. ${e.name} — ${formatGold(e.experience)} XP · ${e.kills.toLocaleString()} kills`);
    const ok = await copyToClipboard(`⚔️ Assault Leaderboard — ${seasonLabel}\n${lines.join('\n')}`);
    if (ok) { setCopied(true); setTimeout(() => setCopied(false), 2000); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/assault"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" />Assault</Button></Link>
        <div>
          <h1 className="text-2xl font-bold">⚔️ Assault Leaderboard</h1>
          <p className="text-muted-foreground">Member rankings from conquest contributions</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <CardTitle>Assault Rankings</CardTitle>
              <CardDescription>{seasonLabel} · total XP and kills across all zones</CardDescription>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Select value={season} onValueChange={setSeason}>
                <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="current">Current season</SelectItem>
                  <SelectItem value="all">All time</SelectItem>
                  {data?.seasons.map(s => <SelectItem key={s} value={String(s)}>Season {s}</SelectItem>)}
                </SelectContent>
              </Select>

              <Tabs value={sort} onValueChange={(v) => setSort(v as Sort)}>
                <TabsList>
                  <TabsTrigger value="experience">XP</TabsTrigger>
                  <TabsTrigger value="kills">Kills</TabsTrigger>
                </TabsList>
              </Tabs>

              <Select value={guild} onValueChange={setGuild}>
                <SelectTrigger className="w-[180px]"><SelectValue placeholder="All Guilds" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Guilds</SelectItem>
                  {data?.guilds.map(g => <SelectItem key={g.id} value={String(g.id)}>{g.name}</SelectItem>)}
                </SelectContent>
              </Select>

              <Button variant="outline" size="sm" onClick={() => setMerged(!merged)}
                title={merged ? 'Switch to individual character view' : 'Switch to merged alt view'}>
                {merged ? 'Merged' : 'Individual'}
              </Button>

              <Button variant="outline" size="sm" onClick={handleCopy} disabled={entries.length === 0}>
                {copied ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
                {copied ? 'Copied!' : 'Copy'}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
          ) : entries.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No assault data yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-left text-muted-foreground text-sm border-b">
                    <th className="pb-3 w-16">Rank</th>
                    <th className="pb-3">Member</th>
                    <th className="pb-3">Guild</th>
                    <th className="pb-3 text-right">Kills</th>
                    <th className="pb-3 text-right">XP</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e, index) => {
                    const rank = index + 1;
                    return (
                      <tr key={e.key} className={`border-b last:border-0 ${rank <= 3 ? 'bg-muted/30' : ''}`}>
                        <td className="py-3"><span className="text-lg">{getRankEmoji(rank)}</span></td>
                        <td className="py-3">
                          <Link href={profilePath(e.name)} className="font-medium hover:underline underline-offset-4">{e.name}</Link>
                          {e.total_level ? <span className="ml-1.5 text-xs text-muted-foreground">Lv {e.total_level}</span> : null}
                          {merged && e.alt_count > 0 && (
                            <span className="ml-1.5 text-xs text-blue-400" title={`Alts: ${e.alt_names.join(', ')}`}>
                              +{e.alt_count} alt{e.alt_count > 1 ? 's' : ''}
                            </span>
                          )}
                          <div className="text-xs text-muted-foreground">
                            {e.zones} zone{e.zones === 1 ? '' : 's'}{season === 'all' ? ` · ${e.seasons} season${e.seasons === 1 ? '' : 's'}` : ''}
                          </div>
                        </td>
                        <td className="py-3"><span className="font-mono text-sm font-bold text-primary">{e.guild_name || '-'}</span></td>
                        <td className="py-3 text-right font-mono">{e.kills.toLocaleString()}</td>
                        <td className="py-3 text-right font-bold text-lg">{formatGold(e.experience)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
