'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2, Check, AlertCircle, Copy, UserPlus, UserMinus, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
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
  const [missingItems, setMissingItems] = useState<string[]>([]);
  const [itemQuantities, setItemQuantities] = useState<Record<string, number>>({});
  const [addingItems, setAddingItems] = useState(false);
  const [expandedMembers, setExpandedMembers] = useState<Set<string>>(new Set());
  const [manualOverrides, setManualOverrides] = useState<Record<string, boolean>>({});
  const [lastLogEntries, setLastLogEntries] = useState<Array<{ ign: string; raids: number; gold: number }>>([]);
  const [lastLogDate, setLastLogDate] = useState<string | null>(null);
  const api = useApiClient();

  // Fetch config and last log entries on mount
  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch donation requirement from config
        const configRes = await api.get('/api/config');
        if (configRes.ok) {
          const configData = await configRes.json();
          setDonationReq(configData.donation_requirement || 5000);
        }

        // Fetch last activity log's last 3 entries
        const historyRes = await api.get('/api/activity/history');
        if (historyRes.ok) {
          const historyData = await historyRes.json();
          if (historyData && historyData.length > 0) {
            // Get the most recent date that's not today
            const today = getToday();
            const previousLog = historyData.find((day: any) => day.date !== today);

            if (previousLog && previousLog.logs && previousLog.logs.length > 0) {
              // Get top 3 entries (chronologically first - these appear first in game log)
              const topThree = previousLog.logs.slice(0, 3).map((log: any) => ({
                ign: log.ign,
                raids: log.raids || 0,
                gold: log.gold_donated || 0
              }));
              setLastLogEntries(topThree);
              setLastLogDate(previousLog.date);
            }
          }
        }
      } catch (err) {
        console.error('Failed to fetch data:', err);
      }
    };

    fetchData();
  }, [api]);

  const handleProcess = async () => {
    if (!rawLog.trim()) {
      setError('Please paste an activity log');
      return;
    }

    setProcessing(true);
    setError(null);
    setSuccess(null);
    setResults(null);
    setMissingItems([]);

    try {
      console.log('[Activity] Sending request with raw_log length:', rawLog.length);
      const res = await api.post('/api/activity/parse', { raw_log: rawLog });
      console.log('[Activity] Response status:', res.status);

      const data = await res.json();
      console.log('[Activity] Response data:', data);

      if (!res.ok) {
        // Check if it's a missing items error
        if (data.missing_items && Array.isArray(data.missing_items)) {
          setMissingItems(data.missing_items);
          // Initialize quantities for each missing item
          const initialQuantities: Record<string, number> = {};
          data.missing_items.forEach((item: string) => {
            initialQuantities[item] = 0;
          });
          setItemQuantities(initialQuantities);
          setError('Some items are missing initial quantities. Please enter them below to continue.');
          return;
        }
        throw new Error(data.error || 'Failed to process');
      }

      setResults(data.members);
      setMemberStatusChanges(data.memberStatusChanges || []);
      // Reset manual overrides when new results come in
      setManualOverrides({});
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

  const handleAddMissingItems = async () => {
    // Validate all quantities are set
    const invalidItems = missingItems.filter(item => !itemQuantities[item] || itemQuantities[item] <= 0);
    if (invalidItems.length > 0) {
      setError(`Please enter valid quantities for all items: ${invalidItems.join(', ')}`);
      return;
    }

    setAddingItems(true);
    setError(null);

    try {
      // Add each missing item
      for (const itemName of missingItems) {
        const quantity = itemQuantities[itemName];
        const res = await api.post('/api/challenge-items/add', {
          item_name: itemName,
          initial_quantity: quantity,
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(`Failed to add ${itemName}: ${data.error}`);
        }
      }

      setSuccess(`Added ${missingItems.length} items successfully! Now processing activity log...`);
      setMissingItems([]);
      setItemQuantities({});

      // Automatically retry processing the log
      setTimeout(() => {
        handleProcess();
      }, 500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add items');
    } finally {
      setAddingItems(false);
    }
  };

  const handleSave = async () => {
    if (!results || results.length === 0) return;

    setSaving(true);
    setError(null);

    try {
      // Attach manual overrides to members
      const membersWithOverrides = results.map(member => ({
        ...member,
        manual_override: manualOverrides[member.ign] || false,
      }));

      const res = await api.post('/api/activity', {
        log_date: logDate,
        members: membersWithOverrides,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to save');
      }

      setSuccess(`Saved ${data.saved} member logs to tracker!`);
      setRawLog('');
      setResults(null);
      setManualOverrides({});

      // Refresh last log entries for next day
      try {
        const historyRes = await api.get('/api/activity/history');
        if (historyRes.ok) {
          const historyData = await historyRes.json();
          if (historyData && historyData.length > 0) {
            const today = getToday();
            const previousLog = historyData.find((day: any) => day.date !== today);

            if (previousLog && previousLog.logs && previousLog.logs.length > 0) {
              const topThree = previousLog.logs.slice(0, 3).map((log: any) => ({
                ign: log.ign,
                raids: log.raids || 0,
                gold: log.gold_donated || 0
              }));
              setLastLogEntries(topThree);
              setLastLogDate(previousLog.date);
            }
          }
        }
      } catch (err) {
        console.error('Failed to refresh last log entries:', err);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const toggleMemberExpanded = (ign: string) => {
    setExpandedMembers(prev => {
      const next = new Set(prev);
      if (next.has(ign)) {
        next.delete(ign);
      } else {
        next.add(ign);
      }
      return next;
    });
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
  const totalGold = results?.reduce((sum, m) => sum + m.gold + (m.deposits_gold || 0), 0) || 0;

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
            Paste the raw activity log from the guild tab in-game (includes &quot;Username&quot;, &quot;Participated in a raid&quot;, &quot;Contributed X Item&quot;)
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

          {lastLogEntries.length > 0 && lastLogDate && (
            <div className="p-3 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-green-700 dark:text-green-300">
                  ✅ Last processed from {new Date(lastLogDate).toLocaleDateString()}
                </p>
                <p className="text-xs text-green-600 dark:text-green-400">These were at the top of the Activity Log</p>
              </div>
              <div className="space-y-2">
                {lastLogEntries.map((entry, idx) => (
                  <div key={idx} className="text-xs text-green-700 dark:text-green-300 bg-green-100 dark:bg-green-900/50 px-2 py-1.5 rounded">
                    <div className="font-semibold">{entry.ign}</div>
                    {entry.raids > 0 && (
                      <div className="text-green-600 dark:text-green-400">
                        Participated in {entry.raids} raid{entry.raids > 1 ? 's' : ''}.
                      </div>
                    )}
                    {entry.gold > 0 && (
                      <div className="text-green-600 dark:text-green-400">
                        Contributed {formatGold(entry.gold)} gold.
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-green-600 dark:text-green-400">
                💡 Start copying from the line <strong>after</strong> these in the guild activity log
              </p>
            </div>
          )}

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

      {missingItems.length > 0 && (
        <Card className="border-orange-500/50 bg-orange-500/5">
          <CardHeader>
            <CardTitle className="text-orange-600 dark:text-orange-400">Missing Challenge Item Quantities</CardTitle>
            <CardDescription>
              The following items don&apos;t have initial quantities set. Please enter them to continue processing.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4">
              {missingItems.map((item) => (
                <div key={item} className="flex items-center gap-4">
                  <Label htmlFor={`item-${item}`} className="flex-1 font-medium">
                    {item}
                  </Label>
                  <Input
                    id={`item-${item}`}
                    type="number"
                    min="1"
                    placeholder="Initial quantity"
                    value={itemQuantities[item] || ''}
                    onChange={(e) => {
                      const value = parseInt(e.target.value, 10);
                      setItemQuantities(prev => ({
                        ...prev,
                        [item]: isNaN(value) ? 0 : value,
                      }));
                    }}
                    className="w-40"
                  />
                </div>
              ))}
            </div>
            <Button onClick={handleAddMissingItems} disabled={addingItems}>
              {addingItems ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Adding Items...
                </>
              ) : (
                `Add ${missingItems.length} Items & Continue`
              )}
            </Button>
          </CardContent>
        </Card>
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
            <div className="mb-4 p-3 bg-muted rounded-lg text-sm">
              <p className="font-medium mb-1">Activity Requirements (meet any one):</p>
              <ul className="space-y-1 text-muted-foreground">
                <li>• {formatGold(donationReq)} total gold (challenge donations + valid guild hall deposits)</li>
                <li>• Donate 50% of initial quantity for any challenge item (if enabled in Settings)</li>
              </ul>
            </div>
            <div className="space-y-2">
              {results.map((member, i) => {
                const totalGold = member.gold + (member.deposits_gold || 0);
                const metsTotalGoldReq = totalGold >= donationReq;
                const metsChallengeReq = member.meets_challenge_quantity || false;
                const meetsReq = metsTotalGoldReq || metsChallengeReq || manualOverrides[member.ign];
                const isExpanded = expandedMembers.has(member.ign);

                // Find best item (highest percentage)
                const bestItem = member.donations.reduce((best: any, current: any) => {
                  const currentPct = current.percentage_of_initial || 0;
                  const bestPct = best?.percentage_of_initial || 0;
                  return currentPct > bestPct ? current : best;
                }, null);

                return (
                  <div key={i} className="border rounded-lg">
                    {/* Main Row */}
                    <div className="flex items-center gap-4 p-3">
                      <button
                        onClick={() => toggleMemberExpanded(member.ign)}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </button>
                      <div className="flex-1 grid grid-cols-4 gap-4 items-center">
                        <span className="font-medium">{member.ign}</span>
                        <span className="text-center">{member.raids} raids</span>
                        <div className="text-right">
                          <div>{formatGold(totalGold)}</div>
                          {bestItem && bestItem.percentage_of_initial > 0 && (
                            <div className="text-xs text-muted-foreground">
                              {bestItem.percentage_of_initial}% of {bestItem.item}
                            </div>
                          )}
                        </div>
                        <div className="text-right">
                          <Badge variant={meetsReq ? 'success' : 'secondary'}>
                            {meetsReq ? '✓ Met' : 'Not Met'}
                          </Badge>
                          {manualOverrides[member.ign] && (
                            <span className="ml-2 text-xs text-blue-500">(Manual)</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Expanded Details */}
                    {isExpanded && (
                      <div className="border-t bg-muted/30 p-4 space-y-3">
                        <div className="grid grid-cols-3 gap-4 text-sm">
                          <div>
                            <span className="text-muted-foreground">Total Gold Requirement:</span>
                            <span className={`ml-2 font-medium ${metsTotalGoldReq ? 'text-green-600' : 'text-amber-600'}`}>
                              {formatGold(totalGold)} / {formatGold(donationReq)}
                              {metsTotalGoldReq && ' ✓'}
                            </span>
                          </div>
                          <div className="pl-4 space-y-1 text-xs">
                            <div>
                              <span className="text-muted-foreground">└─ Challenge Donations:</span>
                              <span className="ml-2">{formatGold(member.gold)}</span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">└─ Guild Hall Deposits:</span>
                              <span className={`ml-2 ${(member.deposits_gold || 0) > 0 ? 'text-blue-500' : ''}`}>
                                {formatGold(member.deposits_gold || 0)}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="text-sm">
                          <span className="text-muted-foreground">Challenge Quantity Requirement:</span>
                          <span className={`ml-2 font-medium ${metsChallengeReq ? 'text-green-600' : 'text-muted-foreground'}`}>
                            {metsChallengeReq ? 'Met ✓' : 'Not Met'}
                          </span>
                        </div>

                        {/* Item Donations Breakdown */}
                        {member.donations && member.donations.length > 0 && (
                          <div className="mt-3">
                            <p className="text-sm font-medium mb-2">Challenge Item Donations:</p>
                            <div className="space-y-1 text-xs">
                              {member.donations.map((donation: any, idx: number) => {
                                const meetsItemReq = donation.initial_quantity > 0 &&
                                  donation.quantity >= (donation.initial_quantity / 2);
                                return (
                                  <div key={idx} className="flex justify-between items-center">
                                    <span>{donation.item}</span>
                                    <span className={meetsItemReq ? 'text-green-600 font-medium' : 'text-muted-foreground'}>
                                      {donation.quantity.toLocaleString()}
                                      {donation.initial_quantity > 0 && (
                                        <> / {Math.ceil(donation.initial_quantity / 2).toLocaleString()} ({donation.percentage_of_initial}%)</>
                                      )}
                                      {meetsItemReq && ' ✓'}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Guild Hall Deposits */}
                        {member.deposits && member.deposits.length > 0 && (
                          <div className="mt-3">
                            <p className="text-sm font-medium mb-2">
                              Guild Hall Deposits ({formatGold(member.deposits_gold || 0)}):
                            </p>
                            <div className="space-y-1 text-xs">
                              {member.deposits.map((deposit: any, idx: number) => (
                                <div
                                  key={idx}
                                  className={`flex justify-between items-center ${
                                    deposit.valid === false ? 'opacity-50 line-through' : ''
                                  }`}
                                >
                                  <span className={deposit.valid === false ? 'text-red-500' : ''}>
                                    {deposit.item}
                                    {deposit.valid === false && ' ❌'}
                                  </span>
                                  <span className="text-muted-foreground">
                                    {deposit.quantity.toLocaleString()} ({formatGold(deposit.total)})
                                  </span>
                                </div>
                              ))}
                            </div>
                            {member.deposits.some((d: any) => d.valid === false) && (
                              <p className="text-xs text-amber-600 mt-2">
                                ⚠️ Invalid deposits (not needed for active buildings) don't count toward requirement
                              </p>
                            )}
                          </div>
                        )}

                        <div className="flex items-center gap-2 pt-2">
                          <input
                            type="checkbox"
                            id={`override-${member.ign}`}
                            checked={manualOverrides[member.ign] || false}
                            onChange={(e) => {
                              setManualOverrides(prev => ({
                                ...prev,
                                [member.ign]: e.target.checked,
                              }));
                            }}
                            className="h-4 w-4 rounded border-gray-300"
                          />
                          <Label htmlFor={`override-${member.ign}`} className="text-sm cursor-pointer">
                            Manual override - mark as meeting requirement
                          </Label>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
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
