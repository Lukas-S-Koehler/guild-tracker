'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Settings, Swords, Coins, TrendingUp, CheckCircle2, XCircle, Users } from 'lucide-react';
import { formatGold, formatDate, getLastCompletedDay } from '@/lib/utils';
import ProtectedRoute from '@/components/ProtectedRoute';
import { useAuth } from '@/contexts/AuthContext';

interface TodayLog {
  id: string;
  ign: string;
  met_requirement: boolean;
  raids: number;
  gold: number;
  guild_name: string;
}

interface UniversalStats {
  totalRaids: number;
  totalGold: number;
  totalActiveMembers: number;
  totalGuilds: number;
}

interface DashboardData {
  date: string;
  today: TodayLog[];
  stats: UniversalStats;
}

function DashboardPageContent() {
  const { hasRole, loading: authLoading, currentGuild } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading || !currentGuild) {
      setLoading(authLoading);
      return;
    }

    async function fetchDashboard() {
      setLoading(true);
      try {
        const res = await fetch('/api/dashboard', {
          headers: { 'Cache-Control': 'no-cache' },
        });
        if (res.ok) {
          setData(await res.json());
        }
      } catch (err) {
        console.error('Dashboard fetch failed:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchDashboard();
  }, [authLoading, currentGuild]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Group today's logs by guild
  const byGuild = new Map<string, TodayLog[]>();
  for (const log of data?.today ?? []) {
    if (!byGuild.has(log.guild_name)) byGuild.set(log.guild_name, []);
    byGuild.get(log.guild_name)!.push(log);
  }
  const hasActivityToday = (data?.today.length ?? 0) > 0;
  const totalMetToday = data?.today.filter(l => l.met_requirement).length ?? 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">Guild Dashboard</h1>
        <p className="text-muted-foreground mt-1">{formatDate(data?.date ?? getLastCompletedDay())}</p>
      </div>

      {/* Guild Statistics */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Guild Statistics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <span className="text-sm text-muted-foreground">Met Today</span>
              </div>
              <p className="text-3xl font-bold">{totalMetToday}</p>
              <p className="text-xs text-muted-foreground mt-1">of {data?.today.length ?? 0} logged</p>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-1">
                <Users className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Active Members</span>
              </div>
              <p className="text-3xl font-bold">{data?.stats.totalActiveMembers ?? 0}</p>
              <p className="text-xs text-muted-foreground mt-1">across {data?.stats.totalGuilds ?? 0} guilds</p>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-1">
                <Swords className="h-5 w-5 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Total Raids</span>
              </div>
              <p className="text-3xl font-bold">{data?.stats.totalRaids?.toLocaleString() ?? 0}</p>
              <p className="text-xs text-muted-foreground mt-1">all time</p>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-1">
                <Coins className="h-5 w-5 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Total Gold</span>
              </div>
              <p className="text-3xl font-bold">{formatGold(data?.stats.totalGold ?? 0)}</p>
              <p className="text-xs text-muted-foreground mt-1">all time</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Today's Activity */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>{data?.date === new Date().toISOString().substring(0, 10) ? "Today's Activity" : `Activity — ${data?.date ?? getLastCompletedDay()}`}</span>
            {hasActivityToday && (
              <span className="text-sm font-normal text-muted-foreground">
                {totalMetToday}/{data?.today.length} met
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!hasActivityToday ? (
            <p className="text-muted-foreground text-sm text-center py-6">
              No activity logged yet today.{' '}
              {hasRole('OFFICER') && (
                <Link href="/activity" className="underline">Process activity log →</Link>
              )}
            </p>
          ) : (
            <div className="space-y-6">
              {Array.from(byGuild.entries()).map(([guildName, logs]) => {
                const met = logs.filter(l => l.met_requirement);
                const notMet = logs.filter(l => !l.met_requirement);
                return (
                  <div key={guildName}>
                    <div className="flex items-center gap-3 mb-3">
                      <span className="text-sm font-semibold">{guildName}</span>
                      <span className="text-xs text-muted-foreground">{met.length}/{logs.length} met</span>
                      <div className="flex-1 h-px bg-border" />
                    </div>
                    <div className="grid md:grid-cols-2 gap-4">
                      {/* Met */}
                      <div className="space-y-0.5">
                        {met.length === 0 ? (
                          <p className="text-xs text-muted-foreground px-2 py-1">None yet</p>
                        ) : met.map(log => (
                          <div key={log.id} className="flex items-center justify-between text-sm px-2 py-1 rounded hover:bg-muted/40">
                            <div className="flex items-center gap-2">
                              <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
                              <span className="font-medium">{log.ign}</span>
                            </div>
                            <span className="text-muted-foreground text-xs">
                              {formatGold(log.gold)}{log.raids > 0 && ` · ${log.raids}⚔`}
                            </span>
                          </div>
                        ))}
                      </div>

                      {/* Not met */}
                      <div className="space-y-0.5">
                        {notMet.length === 0 ? (
                          <p className="text-xs text-muted-foreground px-2 py-1">All met ✓</p>
                        ) : notMet.map(log => (
                          <div key={log.id} className="flex items-center justify-between text-sm px-2 py-1 rounded hover:bg-muted/40">
                            <div className="flex items-center gap-2">
                              <XCircle className="h-3 w-3 text-red-400 shrink-0" />
                              <span className="text-muted-foreground">{log.ign}</span>
                            </div>
                            <span className="text-muted-foreground text-xs">
                              {formatGold(log.gold)}{log.raids > 0 && ` · ${log.raids}⚔`}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick Links */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Links</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Button asChild variant="outline" className="h-auto py-4">
            <Link href="/members" className="flex flex-col items-center gap-2">
              <span className="text-2xl">👥</span>
              <span className="text-sm">Members</span>
            </Link>
          </Button>

          <Button asChild variant="outline" className="h-auto py-4">
            <Link href="/leaderboard" className="flex flex-col items-center gap-2">
              <span className="text-2xl">🏆</span>
              <span className="text-sm">Leaderboard</span>
            </Link>
          </Button>

          {hasRole('OFFICER') && (
            <Button asChild variant="outline" className="h-auto py-4">
              <Link href="/challenges" className="flex flex-col items-center gap-2">
                <span className="text-2xl">📋</span>
                <span className="text-sm">Challenges</span>
              </Link>
            </Button>
          )}

          {hasRole('OFFICER') && (
            <Button asChild variant="outline" className="h-auto py-4">
              <Link href="/setup" className="flex flex-col items-center gap-2">
                <Settings className="h-5 w-5" />
                <span className="text-sm">Settings</span>
              </Link>
            </Button>
          )}

          <Button asChild variant="outline" className="h-auto py-4">
            <Link href="/activity" className="flex flex-col items-center gap-2">
              <span className="text-2xl">📅</span>
              <span className="text-sm">Activity</span>
            </Link>
          </Button>

          <Button asChild variant="outline" className="h-auto py-4">
            <Link href="/reports" className="flex flex-col items-center gap-2">
              <span className="text-2xl">📊</span>
              <span className="text-sm">Inactivity Report</span>
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <ProtectedRoute requiredRole="MEMBER">
      <DashboardPageContent />
    </ProtectedRoute>
  );
}
