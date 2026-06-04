'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Settings, Swords, Coins, TrendingUp, CheckCircle2, XCircle, Users, Trophy, Star } from 'lucide-react';
import { formatGold, formatDate, getLastCompletedDay } from '@/lib/utils';
import ProtectedRoute from '@/components/ProtectedRoute';
import CronCountdown from '@/components/CronCountdown';
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

interface GuildInactivity {
  guildName: string;
  warn1: number;
  warn2: number;
  kick: number;
}

interface TopContributor {
  ign: string;
  gold: number;
  raids: number;
  guildName: string;
}

interface TopGuild {
  name: string;
  gold: number;
  raids: number;
  memberCount: number;
}

interface DashboardData {
  date: string;
  today: TodayLog[];
  stats: UniversalStats;
  inactivityByGuild: GuildInactivity[];
  topContributor: TopContributor | null;
  topGuild: TopGuild | null;
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
        const res = await fetch('/api/dashboard', { headers: { 'Cache-Control': 'no-cache' } });
        if (res.ok) setData(await res.json());
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

  const byGuild = new Map<string, TodayLog[]>();
  for (const log of data?.today ?? []) {
    if (!byGuild.has(log.guild_name)) byGuild.set(log.guild_name, []);
    byGuild.get(log.guild_name)!.push(log);
  }
  const hasActivityToday = (data?.today.length ?? 0) > 0;
  const totalMetToday = data?.today.filter(l => l.met_requirement).length ?? 0;
  const inactiveGuilds = (data?.inactivityByGuild ?? []).filter(g => g.warn1 + g.warn2 + g.kick > 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Guild Dashboard</h1>
        <div className="flex items-center gap-3 mt-1">
          <p className="text-muted-foreground">{formatDate(data?.date ?? getLastCompletedDay())}</p>
          <CronCountdown />
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <Users className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Members</span>
            </div>
            <p className="text-2xl font-bold">{data?.stats.totalActiveMembers ?? 0}</p>
            <p className="text-xs text-muted-foreground">across {data?.stats.totalGuilds ?? 0} guilds</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <span className="text-xs text-muted-foreground">Met Today</span>
            </div>
            <p className="text-2xl font-bold">{totalMetToday}</p>
            <p className="text-xs text-muted-foreground">of {data?.today.length ?? 0} logged</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <Swords className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">All-time Raids</span>
            </div>
            <p className="text-2xl font-bold">{data?.stats.totalRaids?.toLocaleString() ?? 0}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <Coins className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">All-time Gold</span>
            </div>
            <p className="text-2xl font-bold">{formatGold(data?.stats.totalGold ?? 0)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Inactivity overview */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Inactivity Overview</CardTitle>
        </CardHeader>
        <CardContent>
          {inactiveGuilds.length === 0 ? (
            <p className="text-sm text-muted-foreground">All guilds clean ✓</p>
          ) : (
            <div className="flex flex-wrap gap-4">
              {inactiveGuilds.map(g => (
                <div key={g.guildName} className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">{g.guildName}</span>
                  {g.warn1 > 0 && (
                    <Badge variant="outline" className="text-xs bg-yellow-500/10 text-yellow-500 border-yellow-500/40 px-1.5 py-0">
                      ⚠️ {g.warn1}
                    </Badge>
                  )}
                  {g.warn2 > 0 && (
                    <Badge variant="outline" className="text-xs bg-orange-500/10 text-orange-500 border-orange-500/40 px-1.5 py-0">
                      ⚠️⚠️ {g.warn2}
                    </Badge>
                  )}
                  {g.kick > 0 && (
                    <Badge variant="outline" className="text-xs bg-red-500/10 text-red-500 border-red-500/40 px-1.5 py-0">
                      🚫 {g.kick}
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Spotlight */}
      {hasActivityToday && (
        <div className="grid md:grid-cols-2 gap-4">
          {/* Top contributor */}
          <Card className="border-yellow-500/30 bg-yellow-500/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2 text-yellow-500">
                <Star className="h-4 w-4" />
                Top Contributor Today
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data?.topContributor ? (
                <div>
                  <p className="text-2xl font-bold">{data.topContributor.ign}</p>
                  <p className="text-sm text-muted-foreground mt-0.5">{data.topContributor.guildName}</p>
                  <div className="flex items-center gap-3 mt-2">
                    <span className="text-sm font-medium text-yellow-500">{formatGold(data.topContributor.gold)}</span>
                    {data.topContributor.raids > 0 && (
                      <span className="text-xs text-muted-foreground">{data.topContributor.raids} raids</span>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No data yet</p>
              )}
            </CardContent>
          </Card>

          {/* Top guild */}
          <Card className="border-blue-500/30 bg-blue-500/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2 text-blue-400">
                <Trophy className="h-4 w-4" />
                Top Guild Today
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data?.topGuild ? (
                <div>
                  <p className="text-2xl font-bold">{data.topGuild.name}</p>
                  <p className="text-sm text-muted-foreground mt-0.5">{data.topGuild.memberCount} members logged</p>
                  <div className="flex items-center gap-3 mt-2">
                    <span className="text-sm font-medium text-blue-400">{formatGold(data.topGuild.gold)}</span>
                    {data.topGuild.raids > 0 && (
                      <span className="text-xs text-muted-foreground">{data.topGuild.raids} raids</span>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No data yet</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Today's Activity */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base">
            <span>Today&apos;s Activity</span>
            {hasActivityToday && (
              <span className="text-sm font-normal text-muted-foreground">{totalMetToday}/{data?.today.length} met</span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!hasActivityToday ? (
            <p className="text-muted-foreground text-sm text-center py-6">
              No activity logged yet.{' '}
              {hasRole('OFFICER') && (
                <Link href="/activity" className="underline">Process activity log →</Link>
              )}
            </p>
          ) : (
            <div className="space-y-5">
              {Array.from(byGuild.entries()).map(([guildName, logs]) => {
                const met = logs.filter(l => l.met_requirement);
                const notMet = logs.filter(l => !l.met_requirement);
                return (
                  <div key={guildName}>
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-sm font-semibold">{guildName}</span>
                      <span className="text-xs text-muted-foreground">{met.length}/{logs.length} met</span>
                      <div className="flex-1 h-px bg-border" />
                    </div>
                    <div className="grid md:grid-cols-2 gap-3">
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
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Quick Links</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Button asChild variant="outline" className="h-auto py-3">
            <Link href="/members" className="flex flex-col items-center gap-1.5">
              <span className="text-xl">👥</span>
              <span className="text-xs">Members</span>
            </Link>
          </Button>
          <Button asChild variant="outline" className="h-auto py-3">
            <Link href="/leaderboard" className="flex flex-col items-center gap-1.5">
              <span className="text-xl">🏆</span>
              <span className="text-xs">Leaderboard</span>
            </Link>
          </Button>
          {hasRole('OFFICER') && (
            <Button asChild variant="outline" className="h-auto py-3">
              <Link href="/challenges" className="flex flex-col items-center gap-1.5">
                <span className="text-xl">📋</span>
                <span className="text-xs">Challenges</span>
              </Link>
            </Button>
          )}
          <Button asChild variant="outline" className="h-auto py-3">
            <Link href="/activity" className="flex flex-col items-center gap-1.5">
              <span className="text-xl">📅</span>
              <span className="text-xs">Activity</span>
            </Link>
          </Button>
          <Button asChild variant="outline" className="h-auto py-3">
            <Link href="/reports" className="flex flex-col items-center gap-1.5">
              <span className="text-xl">📊</span>
              <span className="text-xs">Inactivity</span>
            </Link>
          </Button>
          {hasRole('OFFICER') && (
            <Button asChild variant="outline" className="h-auto py-3">
              <Link href="/setup" className="flex flex-col items-center gap-1.5">
                <Settings className="h-4 w-4" />
                <span className="text-xs">Settings</span>
              </Link>
            </Button>
          )}
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
