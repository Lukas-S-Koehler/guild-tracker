'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Settings, FileText, Copy, Swords, Coins, TrendingUp } from 'lucide-react';
import { formatGold, formatDate, getToday } from '@/lib/utils';
import ProtectedRoute from '@/components/ProtectedRoute';
import { useApiClient } from '@/lib/api-client';
import { useAuth } from '@/contexts/AuthContext';

interface DashboardStats {
  hasConfig: boolean;
  guildName: string;
  activeMembersToday: number;
  totalMembers: number;
  totalRaids: number;
  totalGold: number;
  inactiveCount: number;
}

function DashboardPageContent() {
  const api = useApiClient();
  const { hasRole, loading: authLoading, currentGuild } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
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
        const [configRes, todayLogsRes, allTimeRes, reportRes] = await Promise.all([
          api.get('/api/config'),
          api.get(`/api/activity?date=${getToday()}`),
          api.get('/api/leaderboard?period=all'),
          api.get('/api/reports/inactivity'),
        ]);

        const config = configRes.ok ? await configRes.json() : {};
        const todayLogs = todayLogsRes.ok ? await todayLogsRes.json() : [];
        const allTimeData = allTimeRes.ok ? await allTimeRes.json() : [];
        const reportData = reportRes.ok ? await reportRes.json() : [];

        const todayLogsArray = Array.isArray(todayLogs) ? todayLogs : [];
        const allTimeArray = Array.isArray(allTimeData) ? allTimeData : [];
        const reportArray = Array.isArray(reportData) ? reportData : [];

        // Calculate all-time totals from leaderboard data
        const totalRaids = allTimeArray.reduce((sum: number, entry: any) => sum + (entry.total_raids || 0), 0);
        const totalGold = allTimeArray.reduce((sum: number, entry: any) => sum + (entry.total_gold || 0), 0);

        setStats({
          hasConfig: !!config?.api_key,
          guildName: config?.guild_name || 'My Guild',
          activeMembersToday: todayLogsArray.filter((l: { met_requirement: boolean }) => l.met_requirement).length,
          totalMembers: allTimeArray.length,
          totalRaids,
          totalGold,
          inactiveCount: reportArray.length,
        });
      } catch (error) {
        console.error('Failed to fetch stats:', error);
        setStats({
          hasConfig: false,
          guildName: 'My Guild',
          activeMembersToday: 0,
          totalMembers: 0,
          totalRaids: 0,
          totalGold: 0,
          inactiveCount: 0,
        });
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
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">{stats?.guildName || 'Guild'} Tracker</h1>
        <p className="text-muted-foreground mt-1">{formatDate(new Date())}</p>
      </div>

      {/* Main 3 Workflow Cards - Hero Section */}
      <div className="grid md:grid-cols-3 gap-6">
        {/* Activity Log */}
        {hasRole('OFFICER') && (
          <Card className="border-2 border-primary/20 hover:border-primary/40 transition-colors">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <FileText className="h-6 w-6 text-primary" />
                Activity Log
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Process daily activity from guild Discord to track member contributions
              </p>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Active Today:</span>
                  <span className="font-bold">{stats?.activeMembersToday}/{stats?.totalMembers}</span>
                </div>
              </div>
              <Button asChild className="w-full" size="lg">
                <Link href="/activity">Process Activity Log →</Link>
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Discord Output (Reports) */}
        <Card className="border-2 border-primary/20 hover:border-primary/40 transition-colors">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <Copy className="h-6 w-6 text-primary" />
              Discord Output
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Generate formatted reports to copy and paste into Discord
            </p>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Inactive Members:</span>
                <span className="font-bold text-amber-600">{stats?.inactiveCount}</span>
              </div>
            </div>
            <Button asChild className="w-full" size="lg">
              <Link href="/reports">Generate Reports →</Link>
            </Button>
          </CardContent>
        </Card>

        {/* Settings */}
        <Card className="border-2 border-primary/20 hover:border-primary/40 transition-colors">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <Settings className="h-6 w-6 text-primary" />
              Settings
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Configure guild requirements, API keys, and building tracking
            </p>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Config:</span>
                <span className="font-bold text-green-600">{stats?.hasConfig ? 'Ready' : 'Setup Needed'}</span>
              </div>
            </div>
            <Button asChild className="w-full" size="lg" variant="outline">
              <Link href="/setup">Open Settings →</Link>
            </Button>
          </CardContent>
        </Card>
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
                <span className="text-2xl">✅</span>
                <span className="text-sm text-muted-foreground">Active Today</span>
              </div>
              <p className="text-3xl font-bold">{stats?.activeMembersToday}</p>
              <p className="text-xs text-muted-foreground mt-1">of {stats?.totalMembers} members</p>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-1">
                <Swords className="h-5 w-5 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Total Raids</span>
              </div>
              <p className="text-3xl font-bold">{stats?.totalRaids?.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground mt-1">all time</p>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-1">
                <Coins className="h-5 w-5 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Total Gold</span>
              </div>
              <p className="text-3xl font-bold">{formatGold(stats?.totalGold || 0)}</p>
              <p className="text-xs text-muted-foreground mt-1">all time</p>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-2xl">⚠️</span>
                <span className="text-sm text-muted-foreground">Inactive</span>
              </div>
              <p className="text-3xl font-bold text-amber-600">{stats?.inactiveCount}</p>
              <p className="text-xs text-muted-foreground mt-1">
                <Link href="/reports" className="hover:underline">View report →</Link>
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Secondary Actions */}
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
              <Link href="/data-management" className="flex flex-col items-center gap-2">
                <span className="text-2xl">🗂️</span>
                <span className="text-sm">Manage Data</span>
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
