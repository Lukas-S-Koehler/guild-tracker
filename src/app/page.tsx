'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Settings, Users, Swords, Coins } from 'lucide-react';
import { formatGold, formatDate, getToday } from '@/lib/utils';

interface DashboardStats {
  hasConfig: boolean;
  guildName: string;
  totalMembers: number;
  todayLogs: number;
  todayRaids: number;
  todayGold: number;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchStats() {
      try {
        const [configRes, logsRes] = await Promise.all([
          fetch('/api/config'),
          fetch(`/api/activity?date=${getToday()}`),
        ]);

        const config = await configRes.json();
        const logs = await logsRes.json();

        const todayLogs = Array.isArray(logs) ? logs : [];
        
        setStats({
          hasConfig: !!config.api_key,
          guildName: config.guild_name || 'My Guild',
          totalMembers: todayLogs.length,
          todayLogs: todayLogs.filter((l: { met_requirement: boolean }) => l.met_requirement).length,
          todayRaids: todayLogs.reduce((sum: number, l: { raids: number }) => sum + (l.raids || 0), 0),
          todayGold: todayLogs.reduce((sum: number, l: { gold_donated: number }) => sum + (l.gold_donated || 0), 0),
        });
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
      } finally {
        setLoading(false);
      }
    }
    fetchStats();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!stats?.hasConfig) {
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{stats.guildName} Dashboard</h1>
          <p className="text-muted-foreground">{formatDate(new Date())}</p>
        </div>
        <Button asChild variant="outline">
          <Link href="/setup">
            <Settings className="h-4 w-4 mr-2" />
            Settings
          </Link>
        </Button>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Members Today</span>
            </div>
            <p className="text-2xl font-bold mt-1">{stats.totalMembers}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <span className="text-sm">✅</span>
              <span className="text-sm text-muted-foreground">Met Requirement</span>
            </div>
            <p className="text-2xl font-bold mt-1">{stats.todayLogs}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Swords className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Raids Today</span>
            </div>
            <p className="text-2xl font-bold mt-1">{stats.todayRaids}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Coins className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Gold Today</span>
            </div>
            <p className="text-2xl font-bold mt-1">{formatGold(stats.todayGold)}</p>
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

      {/* More Actions */}
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
        </CardContent>
      </Card>
    </div>
  );
}
