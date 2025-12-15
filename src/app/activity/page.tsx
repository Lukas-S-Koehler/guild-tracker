'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2, Check, AlertCircle, Copy } from 'lucide-react';
import { formatGold, getToday, copyToClipboard } from '@/lib/utils';
import type { ProcessedMember } from '@/types';

export default function ActivityPage() {
  const [rawLog, setRawLog] = useState('');
  const [logDate, setLogDate] = useState(getToday());
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [results, setResults] = useState<ProcessedMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleProcess = async () => {
    if (!rawLog.trim()) {
      setError('Please paste an activity log');
      return;
    }

    setProcessing(true);
    setError(null);
    setSuccess(null);
    setResults(null);

    try {
      const res = await fetch('/api/activity/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw_log: rawLog }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to process');
      }

      setResults(data.members);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process');
    } finally {
      setProcessing(false);
    }
  };

  const handleSave = async () => {
    if (!results || results.length === 0) return;

    setSaving(true);
    setError(null);

    try {
      const res = await fetch('/api/activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          log_date: logDate,
          members: results,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to save');
      }

      setSuccess(`Saved ${data.saved} member logs to tracker!`);
      setRawLog('');
      setResults(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleCopyResults = async () => {
    if (!results) return;

    const text = results
      .map(m => `${m.ign}: ${m.raids} raids, ${formatGold(m.gold)} gold`)
      .join('\n');

    const ok = await copyToClipboard(text);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const totalRaids = results?.reduce((sum, m) => sum + m.raids, 0) || 0;
  const totalGold = results?.reduce((sum, m) => sum + m.gold, 0) || 0;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">📝 Process Activity Log</h1>
        <p className="text-muted-foreground">
          Paste your guild&apos;s activity log to track raids and donations
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Activity Log Input</CardTitle>
          <CardDescription>
            Paste the raw activity log from Discord (includes &quot;* Username&quot;, &quot;Participated in a raid&quot;, &quot;Contributed X Item&quot;)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="date">Log Date</Label>
              <Input
                id="date"
                type="date"
                value={logDate}
                onChange={(e) => setLogDate(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Activity Log</Label>
            <Textarea
              placeholder={`Paste activity log here...

Example format:
* Username
Participated in a raid.
1d
* AnotherUser
Contributed 100 Iron Ore
2h`}
              value={rawLog}
              onChange={(e) => setRawLog(e.target.value)}
              rows={12}
              className="font-mono text-sm"
            />
          </div>

          <Button onClick={handleProcess} disabled={processing || !rawLog.trim()}>
            {processing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Processing & Fetching Prices...
              </>
            ) : (
              'Process Activity Log'
            )}
          </Button>
        </CardContent>
      </Card>

      {error && (
        <div className="flex items-center gap-2 p-4 bg-destructive/10 text-destructive rounded-lg">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {success && (
        <div className="flex items-center gap-2 p-4 bg-green-500/10 text-green-500 rounded-lg">
          <Check className="h-4 w-4 flex-shrink-0" />
          {success}
        </div>
      )}

      {results && results.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Processed Results</CardTitle>
              <Button variant="outline" size="sm" onClick={handleCopyResults}>
                {copied ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
                {copied ? 'Copied!' : 'Copy'}
              </Button>
            </div>
            <CardDescription>
              {results.length} members • {totalRaids} total raids • {formatGold(totalGold)} total gold
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b">
                    <th className="pb-2">Member</th>
                    <th className="pb-2 text-center">Raids</th>
                    <th className="pb-2 text-right">Gold</th>
                    <th className="pb-2 text-right">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((member, i) => {
                    const meetsReq = member.gold >= 5000; // TODO: get from config
                    return (
                      <tr key={i} className="border-b last:border-0">
                        <td className="py-2 font-medium">{member.ign}</td>
                        <td className="py-2 text-center">{member.raids}</td>
                        <td className="py-2 text-right">{formatGold(member.gold)}</td>
                        <td className="py-2 text-right">
                          <Badge variant={meetsReq ? 'success' : 'secondary'}>
                            {meetsReq ? '✓ Met' : 'Not Met'}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex gap-3 mt-6">
              <Button onClick={handleSave} disabled={saving} className="flex-1">
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  `Save to Daily Tracker (${logDate})`
                )}
              </Button>
              <Button variant="outline" onClick={() => setResults(null)}>
                Clear
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {results && results.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No valid activity found in the log. Make sure the format is correct.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
