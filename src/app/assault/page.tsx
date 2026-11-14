'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, BookOpen, CheckSquare, BarChart3, Settings, Swords, FlaskConical } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

interface GuildSummary {
  guild_id: string;
  guild_name: string;
  active: boolean;
  launch_time_utc: string;
  zone_name: string;
  level_range: string;
  shrine_info: string;
  tracked_zone_id: number | null;
  active_run: { ends_at: string; starts_at: string; zone_name: string } | null;
  last_run: { ends_at: string; zone_name: string; total_kills: number; total_experience: number } | null;
}

function nextLaunchUnix(hhmmss: string): number {
  const [h, m] = hhmmss.split(':').map((n) => parseInt(n, 10));
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, m, 0));
  if (d.getTime() <= now.getTime()) d.setUTCDate(d.getUTCDate() + 1);
  return Math.floor(d.getTime() / 1000);
}

export default function AssaultLandingPage() {
  const { hasRole, isSuperAdmin } = useAuth();
  const canAdmin = isSuperAdmin || hasRole('DEPUTY');
  const [guilds, setGuilds] = useState<GuildSummary[] | null>(null);

  useEffect(() => {
    fetch('/api/assault/public')
      .then((r) => r.json())
      .then((j) => setGuilds(j.guilds ?? []))
      .catch(() => setGuilds([]));
  }, []);

  return (
    <div className="container mx-auto p-4 max-w-5xl space-y-6">
      <div className="flex items-center gap-2">
        <Swords className="h-7 w-7 text-orange-500" />
        <div>
          <h1 className="text-2xl font-bold">Assault</h1>
          <p className="text-sm text-muted-foreground">Guild assault schedule, checklist, stats, and guide.</p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
        <Link href="/assault/guide">
          <Card className="h-full hover:border-orange-500/60 transition">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><BookOpen className="h-4 w-4" />Guide</CardTitle>
              <CardDescription>Zone info, 5Ps, hits-to-kill, gear.</CardDescription>
            </CardHeader>
          </Card>
        </Link>
        <Link href="/assault/checklist">
          <Card className="h-full hover:border-orange-500/60 transition">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><CheckSquare className="h-4 w-4" />Checklist</CardTitle>
              <CardDescription>Track your prep each launch.</CardDescription>
            </CardHeader>
          </Card>
        </Link>
        <Link href="/assault/potions">
          <Card className="h-full hover:border-orange-500/60 transition">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><FlaskConical className="h-4 w-4" />Potions</CardTitle>
              <CardDescription>Plan stacks, costs, restacks.</CardDescription>
            </CardHeader>
          </Card>
        </Link>
        <Link href="/assault/stats">
          <Card className="h-full hover:border-orange-500/60 transition">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><BarChart3 className="h-4 w-4" />Stats</CardTitle>
              <CardDescription>Season leaderboards & history.</CardDescription>
            </CardHeader>
          </Card>
        </Link>
        {canAdmin && (
          <Link href="/assault/admin">
            <Card className="h-full hover:border-orange-500/60 transition">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base"><Settings className="h-4 w-4" />Admin</CardTitle>
                <CardDescription>Configure schedule, pings, zone.</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        )}
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-2">Guild status</h2>
        {!guilds && <Loader2 className="h-5 w-5 animate-spin" />}
        {guilds && guilds.length === 0 && (
          <p className="text-sm text-muted-foreground">No assault configs yet.</p>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          {guilds?.map((g) => {
            const launchUnix = nextLaunchUnix(g.launch_time_utc);
            return (
              <Card key={g.guild_id}>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between text-base">
                    <span>{g.guild_name}</span>
                    <Badge variant={g.active ? 'default' : 'secondary'}>{g.active ? 'Active' : 'Paused'}</Badge>
                  </CardTitle>
                  <CardDescription>
                    {g.zone_name} · Lv {g.level_range} · {g.shrine_info}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">Next launch: </span>
                    <span>{g.launch_time_utc} UTC</span>
                    <span className="text-muted-foreground"> · in {Math.max(0, Math.floor((launchUnix * 1000 - Date.now()) / 60000))}m</span>
                  </div>
                  {g.active_run && (
                    <div className="text-orange-500">
                      ⚔️ Live assault — ends {new Date(g.active_run.ends_at).toLocaleString()}
                    </div>
                  )}
                  {g.last_run && (
                    <div className="text-muted-foreground">
                      Last: {g.last_run.total_kills.toLocaleString()} kills · {g.last_run.total_experience.toLocaleString()} XP
                    </div>
                  )}
                  <div className="flex gap-2 pt-2">
                    <Link href="/assault/checklist"><Button size="sm" variant="outline">Checklist</Button></Link>
                    <Link href="/assault/stats"><Button size="sm" variant="outline">Stats</Button></Link>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
