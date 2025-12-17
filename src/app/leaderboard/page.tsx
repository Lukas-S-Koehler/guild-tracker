'use client';

import { useState, useEffect } from 'react';

// Force dynamic rendering, disable all caching
export const dynamic = 'force-dynamic';
export const revalidate = 0;
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Copy, Check } from 'lucide-react';
import { formatGold, getRankEmoji, formatLeaderboard, copyToClipboard } from '@/lib/utils';
import { useApiClient } from '@/lib/api-client';

type Period = 'week' | 'month' | 'all';

interface Guild {
  id: string;
  name: string;
  nickname: string;
  min_level: number;
}

interface LeaderboardEntry {
  id: string;
  ign: string;
  guild_nickname: string;
  guild_name: string;
  current_guild_id: string;
  total_raids: number;
  total_gold: number;
  activity_score: number;
  days_active: number;
}

export default function LeaderboardPage() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [guilds, setGuilds] = useState<Guild[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>('week');
  const [guildFilter, setGuildFilter] = useState<string>('all');
  const [copied, setCopied] = useState(false);
  const api = useApiClient();

  // Fetch guilds list on mount
  useEffect(() => {
    async function fetchGuilds() {
      try {
        const res = await api.get('/api/guilds');
        const data = await res.json();
        setGuilds(Array.isArray(data) ? data : []);
      } catch (error) {
        console.error('Failed to fetch guilds:', error);
      }
    }
    fetchGuilds();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    async function fetchLeaderboard() {
      setLoading(true);
      try {
        const url = guildFilter === 'all'
          ? `/api/leaderboard?period=${period}`
          : `/api/leaderboard?period=${period}&guild=${guildFilter}`;
        const res = await api.get(url);
        const data = await res.json();
        setEntries(Array.isArray(data) ? data : []);
      } catch (error) {
        console.error('Failed to fetch leaderboard:', error);
        setEntries([]);
      } finally {
        setLoading(false);
      }
    }
    fetchLeaderboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, guildFilter]);

  const handleCopy = async () => {
    const periodLabel = period === 'week' ? 'This Week' : period === 'month' ? 'This Month' : 'All Time';
    const text = formatLeaderboard(entries, periodLabel);
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">🏆 Leaderboard</h1>
        <p className="text-muted-foreground">
          Activity rankings based on raids and donations
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <CardTitle>Activity Rankings</CardTitle>
              <CardDescription>Score = (Raids × 1,000) + Gold Donated</CardDescription>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Tabs value={period} onValueChange={(v) => setPeriod(v as Period)}>
                <TabsList>
                  <TabsTrigger value="week">Week</TabsTrigger>
                  <TabsTrigger value="month">Month</TabsTrigger>
                  <TabsTrigger value="all">All Time</TabsTrigger>
                </TabsList>
              </Tabs>

              <Select value={guildFilter} onValueChange={setGuildFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="All Guilds" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Guilds</SelectItem>
                  {guilds.map((guild) => (
                    <SelectItem key={guild.id} value={guild.id}>
                      {guild.nickname} - {guild.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button variant="outline" size="sm" onClick={handleCopy} disabled={entries.length === 0}>
                {copied ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
                {copied ? 'Copied!' : 'Copy'}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : entries.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              No activity data yet. Process some activity logs first!
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-left text-muted-foreground text-sm border-b">
                    <th className="pb-3 w-16">Rank</th>
                    <th className="pb-3">Member</th>
                    <th className="pb-3">Guild</th>
                    <th className="pb-3 text-right">Raids</th>
                    <th className="pb-3 text-right">Gold</th>
                    <th className="pb-3 text-right">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry, index) => {
                    const rank = index + 1;
                    return (
                      <tr key={entry.id} className={`border-b last:border-0 ${rank <= 3 ? 'bg-muted/30' : ''}`}>
                        <td className="py-3">
                          <span className="text-lg">{getRankEmoji(rank)}</span>
                        </td>
                        <td className="py-3">
                          <div>
                            <span className="font-medium">{entry.ign}</span>
                            <div className="text-xs text-muted-foreground">
                              {entry.days_active}d active
                            </div>
                          </div>
                        </td>
                        <td className="py-3">
                          <span className="font-mono text-sm font-bold text-primary">
                            {entry.guild_nickname || '-'}
                          </span>
                        </td>
                        <td className="py-3 text-right font-mono">{entry.total_raids}</td>
                        <td className="py-3 text-right font-mono">{formatGold(entry.total_gold)}</td>
                        <td className="py-3 text-right font-bold text-lg">{formatGold(entry.activity_score)}</td>
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
