'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Settings, Users, Swords, Coins, ClipboardList } from 'lucide-react';
import { formatGold, formatDate, getToday } from '@/lib/utils';
import ProtectedRoute from '@/components/ProtectedRoute';
import { useApiClient } from '@/lib/api-client';
import { useAuth } from '@/contexts/AuthContext';

interface DashboardStats {
  hasConfig: boolean;
  guildName: string;
  activeMembersToday: number;
  totalRaids: number;
  totalGold: number;
}

interface Challenge {
  id: string;
  challenge_date: string;
  total_cost: number;
  items: { name: string; quantity: number; price: number; total: number; isExpensive?: boolean }[];
}

interface InactivityEntry {
  id: string;
  ign: string;
  category: string;
}

function DashboardPageContent() {
  const api = useApiClient();
  const { hasRole, loading: authLoading, currentGuild } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [inactiveMembers, setInactiveMembers] = useState<InactivityEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Don't fetch until auth is loaded and we have a guild
    if (authLoading || !currentGuild) {
      setLoading(authLoading);
      return;
    }

    async function fetchStats() {
      setLoading(true);
      try {
        const [configRes, todayLogsRes, allTimeRes, challengesRes, reportRes] = await Promise.all([
          api.get('/api/config'),
          api.get(`/api/activity?date=${getToday()}`),
          api.get('/api/leaderboard?period=all'),
          api.get('/api/challenges/list'),
          api.get('/api/reports/inactivity'),
        ]);

        if (!configRes.ok) {
          console.error('/api/config failed', configRes.status, await configRes.text());
        }
        if (!challengesRes.ok) {
          console.error('/api/challenges/list failed', challengesRes.status, await challengesRes.text());
        }

        const config = configRes.ok ? await configRes.json() : {};
        const todayLogs = todayLogsRes.ok ? await todayLogsRes.json() : [];
        const allTimeData = allTimeRes.ok ? await allTimeRes.json() : [];
        const challengesData = challengesRes.ok ? await challengesRes.json() : [];
        const reportData = reportRes.ok ? await reportRes.json() : [];

        const todayLogsArray = Array.isArray(todayLogs) ? todayLogs : [];
        const allTimeArray = Array.isArray(allTimeData) ? allTimeData : [];
        const normalizedChallenges = Array.isArray(challengesData) ? challengesData : [];
        const normalizedReport = Array.isArray(reportData) ? reportData : [];

        // Calculate all-time totals from leaderboard data
        const totalRaids = allTimeArray.reduce((sum: number, entry: any) => sum + (entry.total_raids || 0), 0);
        const totalGold = allTimeArray.reduce((sum: number, entry: any) => sum + (entry.total_gold || 0), 0);

        setStats({
          hasConfig: !!config?.api_key,
          guildName: config?.guild_name || 'My Guild',
          activeMembersToday: todayLogsArray.filter((l: { met_requirement: boolean }) => l.met_requirement).length,
          totalRaids,
          totalGold,
        });

        setChallenges(normalizedChallenges);
        setInactiveMembers(normalizedReport);
      } catch (error) {
        console.error('Failed to fetch stats:', error);
        setStats({
          hasConfig: false,
          guildName: 'My Guild',
          activeMembersToday: 0,
          totalRaids: 0,
          totalGold: 0,
        });
        setChallenges([]);
        setInactiveMembers([]);
      } finally {
        setLoading(false);
      }
    }
    fetchStats();
  }, [api, authLoading, currentGuild]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!stats?.hasConfig && hasRole('LEADER')) {
    return (
      <div className="max-w-md mx-auto mt-20">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              Setup Required
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground">
              Add your IdleMMO API key to enable market price lookups for donations.
            </p>
            <Button asChild className="w-full">
              <Link href="/setup">Configure API Key</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{stats?.guildName || 'Guild'} Dashboard</h1>
          <p className="text-muted-foreground">{formatDate(new Date())}</p>
        </div>

        <div className="flex items-center gap-2">
          <Button asChild variant="outline">
            <Link href="/members" className="flex items-center">
              <Users className="h-4 w-4 mr-2" />
              Members
            </Link>
          </Button>

          {hasRole('LEADER') && (
            <Button asChild variant="outline">
              <Link href="/setup" className="flex items-center">
                <Settings className="h-4 w-4 mr-2" />
                Settings
              </Link>
            </Button>
          )}
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <span className="text-sm">✅</span>
              <span className="text-sm text-muted-foreground">Active Members Today</span>
            </div>
            <p className="text-2xl font-bold mt-1">{stats?.activeMembersToday || 0}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Swords className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Total Raids</span>
            </div>
            <p className="text-2xl font-bold mt-1">{stats?.totalRaids || 0}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Coins className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Total Gold</span>
            </div>
            <p className="text-2xl font-bold mt-1">{formatGold(stats?.totalGold || 0)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Two-column layout: Challenges (left, narrower) and Reports (right, wider) */}
      <div className="grid md:grid-cols-5 gap-6">
        {/* Recent Challenges - 2 columns */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ClipboardList className="h-5 w-5" />
              Recent Challenges
            </CardTitle>
          </CardHeader>

          <CardContent>
            {challenges.length === 0 ? (
              <p className="text-muted-foreground text-sm">No challenges saved yet.</p>
            ) : (
              <div className="space-y-3">
                {challenges.slice(0, 5).map((c) => (
                  <div key={c.id} className="py-2 border-b last:border-0">
                    <div className="flex justify-between items-start">
                      <p className="font-medium text-sm">{formatDate(new Date(c.challenge_date))}</p>
                      <p className="font-bold text-sm">{formatGold(c.total_cost)}</p>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {c.items?.length || 0} items
                    </p>
                  </div>
                ))}
                <Link href="/challenges/list" className="text-xs text-muted-foreground hover:text-primary block mt-2">
                  View all challenges →
                </Link>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Inactivity Report - 3 columns */}
        <Card className="md:col-span-3">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                📊 Inactivity Report
              </span>
              <Link href="/reports">
                <Button variant="ghost" size="sm" className="text-xs">
                  View Full Report →
                </Button>
              </Link>
            </CardTitle>
          </CardHeader>

          <CardContent>
            {inactiveMembers.length === 0 ? (
              <p className="text-muted-foreground text-sm">No inactive members! 🎉</p>
            ) : (
              <div className="space-y-3">
                {/* Group by category */}
                {['1w+', 'never', '6d', '5d', '4d'].map((cat) => {
                  const members = inactiveMembers.filter(m => m.category === cat);
                  if (members.length === 0) return null;

                  const getEmoji = (category: string) => {
                    if (category === '1w+') return '🔴';
                    if (category === 'never') return '💀';
                    if (['6d', '5d', '4d'].includes(category)) return '🟡';
                    return '⚠️';
                  };

                  const getLabel = (category: string) => {
                    if (category === 'never') return 'Never Active';
                    return `${category} Inactive`;
                  };

                  return (
                    <div key={cat} className="flex items-start gap-2">
                      <span className="text-lg">{getEmoji(cat)}</span>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-medium">{getLabel(cat)}</span>
                          <span className="text-xs text-muted-foreground">({members.length})</span>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {members.slice(0, 10).map((member) => (
                            <span
                              key={member.id}
                              className="bg-muted rounded px-2 py-0.5 text-xs"
                            >
                              {member.ign}
                            </span>
                          ))}
                          {members.length > 10 && (
                            <span className="text-xs text-muted-foreground px-2">
                              +{members.length - 10} more
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <p className="text-sm text-muted-foreground pt-2 border-t">
                  Total inactive: <span className="font-bold text-foreground">{inactiveMembers.length}</span>
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">📝 Process Activity Log</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Paste your guild&apos;s Discord activity log to track raids and donations.
            </p>
            <Button asChild className="w-full">
              <Link href="/activity">Process Activity Log</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">📋 Calculate Challenge</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Paste challenge items to calculate total cost and find expensive items.
            </p>
            <Button asChild className="w-full">
              <Link href="/challenges">Calculate Challenge</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* More Actions (deduplicated) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">⚡ Quick Links</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2">
          <Button asChild variant="outline">
            <Link href="/leaderboard">🏆 Leaderboard</Link>
          </Button>

          <Button asChild variant="outline">
            <Link href="/reports">📊 Inactivity Report</Link>
          </Button>

          <Button asChild variant="outline">
            <Link href="/challenges/list">📚 All Challenges</Link>
          </Button>

          <Button asChild variant="outline">
            <Link href="/activity">🗂 Activity</Link>
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
