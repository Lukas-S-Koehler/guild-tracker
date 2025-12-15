'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Copy, Check } from 'lucide-react';
import { getInactivityEmoji, formatInactivityReport, copyToClipboard } from '@/lib/utils';
import type { InactivityEntry } from '@/types';

export default function ReportsPage() {
  const [entries, setEntries] = useState<InactivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [guildName, setGuildName] = useState('Guild');

  useEffect(() => {
    async function fetchData() {
      try {
        const [reportRes, configRes] = await Promise.all([
          fetch('/api/reports/inactivity'),
          fetch('/api/config'),
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

  const categories = ['1d', '2d', '3d', '4d', '5d', '6d', '1w+', 'never'];

  const getCategoryBadgeColor = (cat: string) => {
    if (cat === '1w+' || cat === 'never') return 'bg-red-500/20 text-red-500 border-red-500/50';
    if (['4d', '5d', '6d'].includes(cat)) return 'bg-orange-500/20 text-orange-500 border-orange-500/50';
    return 'bg-yellow-500/20 text-yellow-500 border-yellow-500/50';
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
                Based on daily tracker data (5,000+ gold = active)
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

                return (
                  <div key={cat} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{emoji}</span>
                      <Badge variant="outline" className={getCategoryBadgeColor(cat)}>
                        {label}
                      </Badge>
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

      <div className="text-sm text-muted-foreground p-4 bg-muted rounded-lg">
        <p className="font-medium mb-1">📋 Activity Requirement</p>
        <p>A member is considered active if they donated 5,000+ gold on a given day.</p>
      </div>
    </div>
  );
}
