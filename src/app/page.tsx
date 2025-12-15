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
  totalMembers: number;
  todayLogs: number;
  todayRaids: number;
  todayGold: number;
}

interface Challenge {
  id: string;
  challenge_date: string;
  total_cost: number;
  items: { name: string; quantity: number; price: number; total: number; isExpensive?: boolean }[];
}

function DashboardPageContent() {
  const api = useApiClient();
  const { hasRole } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchStats() {
      try {
        const [configRes, logsRes, challengesRes] = await Promise.all([
          api.get('/api/config'),
          api.get(`/api/activity?date=${getToday()}`),
          api.get('/api/challenges/list'),
        ]);

        if (!configRes.ok) {
          console.error('/api/config failed', configRes.status, await configRes.text());
        }
        if (!challengesRes.ok) {
          console.error('/api/challenges/list failed', challengesRes.status, await challengesRes.text());
        }

        const config = configRes.ok ? await configRes.json() : {};
        const logs = logsRes.ok ? await logsRes.json() : [];
        const challengesData = challengesRes.ok ? await challengesRes.json() : [];

        const todayLogs = Array.isArray(logs) ? logs : [];
        const normalizedChallenges = Array.isArray(challengesData) ? challengesData : [];

        setStats({
          hasConfig: !!config?.api_key,
          guildName: config?.guild_name || 'My Guild',
          totalMembers: todayLogs.length,
          todayLogs: todayLogs.filter((l: { met_requirement: boolean }) => l.met_requirement).length,
          todayRaids: todayLogs.reduce((sum: number, l: { raids: number }) => sum + (l.raids || 0), 0),
          todayGold: todayLogs.reduce((sum: number, l: { gold_donated: number }) => sum + (l.gold_donated || 0), 0),
        });

        setChallenges(normalizedChallenges);
      } catch (error) {
        console.error('Failed to fetch stats:', error);
        setStats({
          hasConfig: false,
          guildName: 'My Guild',
          totalMembers: 0,
          todayLogs: 0,
          todayRaids: 0,
          todayGold: 0,
        });
        setChallenges([]);
      } finally {
        setLoading(false);
      }
    }
    fetchStats();
  }, [api]);

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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Members Today</span>
            </div>
            <p className="text-2xl font-bold mt-1">{stats?.totalMembers || 0}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <span className="text-sm">✅</span>
              <span className="text-sm text-muted-foreground">Met Requirement</span>
            </div>
            <p className="text-2xl font-bold mt-1">{stats?.todayLogs || 0}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Swords className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Raids Today</span>
            </div>
            <p className="text-2xl font-bold mt-1">{stats?.todayRaids || 0}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Coins className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Gold Today</span>
            </div>
            <p className="text-2xl font-bold mt-1">{formatGold(stats?.todayGold || 0)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Condensed Recent Challenges */}
      <Card>
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
              {challenges.slice(0, 6).map((c) => {
                const previewItems = Array.isArray(c.items) ? c.items.slice(0, 3) : [];
                const moreCount = (c.items?.length || 0) - previewItems.length;
                return (
                  <div key={c.id} className="flex items-center justify-between py-2 border-b last:border-0">
                    <div>
                      <p className="font-medium">{formatDate(new Date(c.challenge_date))}</p>
                      <div className="text-xs text-muted-foreground mt-1 flex gap-3">
                        {previewItems.map((it, idx) => (
                          <span key={idx} className="inline-flex items-center gap-2">
                            <span className={it.isExpensive ? 'text-red-500' : ''}>{it.name}</span>
                            <span className="text-muted-foreground">{formatGold(it.total)}</span>
                          </span>
                        ))}
                        {moreCount > 0 && <span className="text-xs text-muted-foreground">+{moreCount} more</span>}
                      </div>
                    </div>

                    <div className="text-right">
                      <p className="font-bold">{formatGold(c.total_cost)}</p>
                      <Link href={`/challenges/list`} className="text-xs text-muted-foreground">
                        View all
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

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
