'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Copy, Check } from 'lucide-react';
import { getInactivityEmoji, formatInactivityReport, copyToClipboard } from '@/lib/utils';
import { useApiClient } from '@/lib/api-client';
import type { InactivityEntry } from '@/types';

export default function ReportsPage() {
  const [entries, setEntries] = useState<InactivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [guildName, setGuildName] = useState('Guild');
  const api = useApiClient();

  useEffect(() => {
    async function fetchData() {
      try {
        const [reportRes, configRes] = await Promise.all([
          api.get('/api/reports/inactivity'),
          api.get('/api/config'),
        ]);

        const reportData = await reportRes.json();
        const configData = await configRes.json();

        setEntries(Array.isArray(reportData) ? reportData : []);
        if (configData.guild_name) {
          setGuildName(configData.guild_name);
        }
      } catch (error) {
        console.error('Failed to fetch report:', error);
        setEntries([]);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCopy = async () => {
    const text = formatInactivityReport(
      entries.map(e => ({ ign: e.ign, category: e.category })),
      guildName
    );
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const grouped = entries.reduce((acc, entry) => {
    if (!acc[entry.category]) acc[entry.category] = [];
    acc[entry.category].push(entry);
    return acc;
  }, {} as Record<string, InactivityEntry[]>);

  const categories = ['1d', '2d', '3d', '4d', '5d', '6d', '7d+', 'never'];

  const getWarningLevelColor = (warning_level: string) => {
    switch (warning_level) {
      case 'safe':
        return 'bg-green-500/20 text-green-500 border-green-500/50';
      case 'warn1':
        return 'bg-yellow-500/20 text-yellow-500 border-yellow-500/50'; // 2-3d: Private warning
      case 'warn2':
        return 'bg-orange-500/20 text-orange-500 border-orange-500/50'; // 4-6d: Public warning
      case 'kick':
        return 'bg-red-500/20 text-red-500 border-red-500/50'; // 7d+: Kick
      default:
        return 'bg-gray-500/20 text-gray-500 border-gray-500/50';
    }
  };

  const getWarningLevelLabel = (warning_level: string) => {
    switch (warning_level) {
      case 'warn1':
        return '⚠️ Private Warning';
      case 'warn2':
        return '⚠️⚠️ Public Warning';
      case 'kick':
        return '🚫 Kick';
      default:
        return '';
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">📊 Inactivity Report</h1>
        <p className="text-muted-foreground">
          Members who haven&apos;t met activity requirements
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Inactive Members</CardTitle>
              <CardDescription>
                Based on daily tracker data (excludes Leaders & Deputies)
              </CardDescription>
            </div>
            <Button variant="outline" onClick={handleCopy} disabled={loading || entries.length === 0}>
              {copied ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
              {copied ? 'Copied!' : 'Copy for Discord'}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : entries.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              No inactive members found! 🎉
            </p>
          ) : (
            <div className="space-y-4">
              {categories.map((cat) => {
                const members = grouped[cat];
                if (!members || members.length === 0) return null;

                const emoji = getInactivityEmoji(cat);
                const label = cat === 'never' ? 'Never Active' : `${cat} Inactive`;
                const warning_level = members[0]?.warning_level || 'safe';
                const warningLabel = getWarningLevelLabel(warning_level);

                return (
                  <div key={cat} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{emoji}</span>
                      <Badge variant="outline" className={getWarningLevelColor(warning_level)}>
                        {label}
                      </Badge>
                      {warningLabel && (
                        <span className="text-xs font-medium text-muted-foreground">
                          {warningLabel}
                        </span>
                      )}
                      <span className="text-sm text-muted-foreground">
                        ({members.length})
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2 pl-7">
                      {members.map((member) => (
                        <div
                          key={member.id}
                          className="bg-muted rounded-full px-3 py-1 text-sm"
                        >
                          {member.ign}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}

              <div className="pt-4 border-t">
                <p className="text-sm text-muted-foreground">
                  Total inactive: <span className="font-bold text-foreground">{entries.length}</span>
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="text-sm text-muted-foreground p-4 bg-muted rounded-lg space-y-3">
        <div>
          <p className="font-medium mb-1">📋 Activity Requirement</p>
          <p>A member is considered active if they meet either requirement:</p>
          <ul className="list-disc list-inside mt-1 space-y-1">
            <li>Donated 5,000+ gold in a day, OR</li>
            <li>Donated 50% or more of the daily challenge requirement</li>
          </ul>
        </div>
        <div>
          <p className="font-medium mb-1">⚠️ Warning Stages</p>
          <ul className="list-disc list-inside mt-1 space-y-1">
            <li><span className="text-yellow-500">2-3 days</span>: Private warning sent</li>
            <li><span className="text-orange-500">4-6 days</span>: Private + public warning in channel</li>
            <li><span className="text-red-500">7+ days</span>: Subject to removal</li>
          </ul>
          <p className="mt-2 text-xs">Note: Leaders and Deputies are excluded from inactivity tracking</p>
        </div>
      </div>
    </div>
  );
}
