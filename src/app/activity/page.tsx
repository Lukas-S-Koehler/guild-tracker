'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2, Check, AlertCircle, Copy, UserPlus, UserMinus, RefreshCw } from 'lucide-react';
import { formatGold, getToday, copyToClipboard } from '@/lib/utils';
import { useApiClient } from '@/lib/api-client';
import type { ProcessedMember } from '@/types';

interface MemberStatusChange {
  ign: string;
  action: 'joined' | 'left' | 'kicked';
}

export default function ActivityPage() {
  const [rawLog, setRawLog] = useState('');
  const [logDate, setLogDate] = useState(getToday());
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [results, setResults] = useState<ProcessedMember[] | null>(null);
  const [memberStatusChanges, setMemberStatusChanges] = useState<MemberStatusChange[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [donationReq, setDonationReq] = useState(5000);
  const [challengeTotal, setChallengeTotal] = useState(0);
  const api = useApiClient();

  // Fetch config and challenge info on mount and when date changes
  useEffect(() => {
    const fetchRequirements = async () => {
      try {
        // Fetch donation requirement from config
        const configRes = await api.get('/api/config');
        if (configRes.ok) {
          const configData = await configRes.json();
          setDonationReq(configData.donation_requirement || 5000);
        }

        // Fetch challenge for selected date
        const challengeRes = await api.get(`/api/challenges/list?date=${logDate}`);
        if (challengeRes.ok) {
          const challenges = await challengeRes.json();
          if (challenges && challenges.length > 0) {
            setChallengeTotal(challenges[0].total_cost || 0);
          } else {
            setChallengeTotal(0);
          }
        }
      } catch (err) {
        console.error('Failed to fetch requirements:', err);
      }
    };

    fetchRequirements();
  }, [logDate, api]);

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
      console.log('[Activity] Sending request with raw_log length:', rawLog.length);
      const res = await api.post('/api/activity/parse', { raw_log: rawLog });
      console.log('[Activity] Response status:', res.status);

      const data = await res.json();
      console.log('[Activity] Response data:', data);

      if (!res.ok) {
        throw new Error(data.error || 'Failed to process');
      }

      setResults(data.members);
      setMemberStatusChanges(data.memberStatusChanges || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process');
    } finally {
      setProcessing(false);
    }
  };

  const handleAutoSync = async () => {
    setSyncing(true);
    setError(null);

    try {
      const res = await api.post('/api/members/sync');

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to sync members');
      }

      setSuccess('Members synced successfully!');
      setMemberStatusChanges([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sync members');
    } finally {
      setSyncing(false);
    }
  };

  const handleSave = async () => {
    if (!results || results.length === 0) return;

    setSaving(true);
    setError(null);

    try {
      const res = await api.post('/api/activity', {
        log_date: logDate,
        members: results,
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

      {memberStatusChanges.length > 0 && (
        <Card className="border-blue-500/50 bg-blue-500/5">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-blue-600 dark:text-blue-400 flex items-center gap-2">
                  <RefreshCw className="h-5 w-5" />
                  Member Status Changes Detected
                </CardTitle>
                <CardDescription>
                  The activity log contains member join/leave/kick events
                </CardDescription>
              </div>
              <Button onClick={handleAutoSync} disabled={syncing} variant="outline" className="border-blue-500">
                {syncing ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Syncing...
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Sync Members Now
                  </>
                )}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {memberStatusChanges.map((change, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  {change.action === 'joined' && <UserPlus className="h-4 w-4 text-green-500" />}
                  {(change.action === 'left' || change.action === 'kicked') && <UserMinus className="h-4 w-4 text-red-500" />}
                  <span className="font-medium">{change.ign}</span>
                  <span className="text-muted-foreground">
                    {change.action === 'joined' && 'joined the guild'}
                    {change.action === 'left' && 'left the guild'}
                    {change.action === 'kicked' && 'was kicked from the guild'}
                  </span>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-4">
              Click "Sync Members Now" to update the member roster from IdleMMO
            </p>
          </CardContent>
        </Card>
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
            {(donationReq > 0 || challengeTotal > 0) && (
              <div className="mb-4 p-3 bg-muted rounded-lg text-sm">
                <p className="font-medium mb-1">Activity Requirements:</p>
                <ul className="space-y-1 text-muted-foreground">
                  <li>• {formatGold(donationReq)} donated (base requirement)</li>
                  {challengeTotal > 0 && (
                    <li>• {formatGold(Math.floor(challengeTotal / 2))} donated (50% of {formatGold(challengeTotal)} challenge)</li>
                  )}
                </ul>
                <p className="mt-2 text-xs">Members meeting either requirement will be marked as active.</p>
              </div>
            )}
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
                    const metsDonationReq = member.gold >= donationReq;
                    const halfChallengeReq = Math.floor(challengeTotal / 2);
                    const metsChallengeReq = halfChallengeReq > 0 && member.gold >= halfChallengeReq;
                    const meetsReq = metsDonationReq || metsChallengeReq;

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
