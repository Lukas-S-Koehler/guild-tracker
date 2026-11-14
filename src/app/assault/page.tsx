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
  weekdays: number[] | null;
  season_start: string | null;
  season_end: string | null;
  next_launch_unix: number | null;
  active_run: { ends_at: string; starts_at: string; zone_name: string } | null;
  last_run: { ends_at: string; zone_name: string; total_kills: number; total_experience: number } | null;
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatSchedule(g: GuildSummary): string {
  const days = g.weekdays && g.weekdays.length > 0
    ? g.weekdays.slice().sort().map((d) => WEEKDAY_LABELS[d]).join('/')
    : 'no days set';
  const window = g.season_start && g.season_end
    ? ` · ${g.season_start}→${g.season_end}`
    : g.season_start ? ` · from ${g.season_start}`
    : g.season_end ? ` · until ${g.season_end}` : '';
  return `${days} @ ${g.launch_time_utc.slice(0, 5)} UTC${window}`;
}

function formatCountdown(unix: number): string {
  const diffMs = unix * 1000 - Date.now();
  if (diffMs <= 0) return 'now';
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ${mins % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
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
            const launchUnix = g.next_launch_unix;
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
                  <div className="text-muted-foreground">
                    Schedule: {formatSchedule(g)}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Next launch: </span>
                    {launchUnix ? (
                      <>
                        <span>{new Date(launchUnix * 1000).toUTCString().slice(0, 22)} UTC</span>
                        <span className="text-muted-foreground"> · in {formatCountdown(launchUnix)}</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">— (no upcoming day in window)</span>
                    )}
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
