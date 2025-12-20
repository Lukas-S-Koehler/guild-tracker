'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Trash2, Edit, ChevronDown, ChevronRight } from 'lucide-react';
import { formatGold, formatDate } from '@/lib/utils';
import { useApiClient } from '@/lib/api-client';
import ProtectedRoute from '@/components/ProtectedRoute';

interface ActivityLog {
  id: string;
  ign: string;
  raids: number;
  gold_donated: number;
  met_requirement: boolean;
}

interface ActivityDate {
  date: string;
  member_count: number;
  total_raids: number;
  total_gold: number;
  logs: ActivityLog[];
}

interface Challenge {
  id: string;
  challenge_date: string;
  raw_input: string | null;
  total_cost: number;
}

function DataManagementContent() {
  const [activityData, setActivityData] = useState<ActivityDate[]>([]);
  const [challengeData, setChallengeData] = useState<Challenge[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedActivityDates, setSelectedActivityDates] = useState<Set<string>>(new Set());
  const [selectedChallengeDates, setSelectedChallengeDates] = useState<Set<string>>(new Set());
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  const [editingLog, setEditingLog] = useState<{ id: string; raids: number; gold: number } | null>(null);
  const [editingChallenge, setEditingChallenge] = useState<{ id: string; total_cost: number } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const api = useApiClient();

  async function loadData() {
    setLoading(true);
    try {
      const [activityRes, challengeRes] = await Promise.all([
        api.get('/api/activity/history'),
        api.get('/api/challenges/list'),
      ]);

      if (activityRes.ok) {
        const data = await activityRes.json();
        setActivityData(data);
      }

      if (challengeRes.ok) {
        const data = await challengeRes.json();
        setChallengeData(data);
      }
    } catch (err) {
      console.error('Failed to load data:', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  function toggleActivityDate(date: string) {
    const newSet = new Set(selectedActivityDates);
    if (newSet.has(date)) {
      newSet.delete(date);
    } else {
      newSet.add(date);
    }
    setSelectedActivityDates(newSet);
  }

  function toggleChallengeDate(date: string) {
    const newSet = new Set(selectedChallengeDates);
    if (newSet.has(date)) {
      newSet.delete(date);
    } else {
      newSet.add(date);
    }
    setSelectedChallengeDates(newSet);
  }

  function selectAllActivity() {
    if (selectedActivityDates.size === activityData.length) {
      setSelectedActivityDates(new Set());
    } else {
      setSelectedActivityDates(new Set(activityData.map(d => d.date)));
    }
  }

  function selectAllChallenges() {
    if (selectedChallengeDates.size === challengeData.length) {
      setSelectedChallengeDates(new Set());
    } else {
      setSelectedChallengeDates(new Set(challengeData.map(c => c.challenge_date)));
    }
  }

  async function deleteSelectedActivity() {
    if (selectedActivityDates.size === 0) return;

    const confirmed = window.confirm(
      `Are you sure you want to delete activity logs for ${selectedActivityDates.size} date(s)? This cannot be undone.`
    );

    if (!confirmed) return;

    setDeleting(true);
    try {
      const res = await api.post('/api/activity/delete', {
        dates: Array.from(selectedActivityDates),
      });

      if (res.ok) {
        await loadData();
        setSelectedActivityDates(new Set());
      } else {
        const error = await res.json();
        alert(`Failed to delete: ${error.error}`);
      }
    } catch (err) {
      console.error('Delete failed:', err);
      alert('Failed to delete activity logs');
    } finally {
      setDeleting(false);
    }
  }

  async function deleteSelectedChallenges() {
    if (selectedChallengeDates.size === 0) return;

    const confirmed = window.confirm(
      `Are you sure you want to delete ${selectedChallengeDates.size} challenge(s)? This cannot be undone.`
    );

    if (!confirmed) return;

    setDeleting(true);
    try {
      const res = await api.post('/api/challenges/delete', {
        dates: Array.from(selectedChallengeDates),
      });

      if (res.ok) {
        await loadData();
        setSelectedChallengeDates(new Set());
      } else {
        const error = await res.json();
        alert(`Failed to delete: ${error.error}`);
      }
    } catch (err) {
      console.error('Delete failed:', err);
      alert('Failed to delete challenges');
    } finally {
      setDeleting(false);
    }
  }

  async function saveEditLog() {
    if (!editingLog) return;

    try {
      const res = await api.patch('/api/activity/edit', {
        log_id: editingLog.id,
        raids: editingLog.raids,
        gold_donated: editingLog.gold,
      });

      if (res.ok) {
        await loadData();
        setEditingLog(null);
      } else {
        const error = await res.json();
        alert(`Failed to save: ${error.error}`);
      }
    } catch (err) {
      console.error('Edit failed:', err);
      alert('Failed to save changes');
    }
  }

  async function saveEditChallenge() {
    if (!editingChallenge) return;

    try {
      const res = await api.patch('/api/challenges/edit', {
        challenge_id: editingChallenge.id,
        total_cost: editingChallenge.total_cost,
      });

      if (res.ok) {
        await loadData();
        setEditingChallenge(null);
      } else {
        const error = await res.json();
        alert(`Failed to save: ${error.error}`);
      }
    } catch (err) {
      console.error('Edit failed:', err);
      alert('Failed to save changes');
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">🗂️ Data Management</h1>
        <p className="text-muted-foreground">
          View, edit, and delete activity logs and challenges
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Note: Members meet requirements by donating 5k+ gold OR 50% of any challenge item quantity
        </p>
      </div>

      {/* Activity Logs Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Activity Logs</CardTitle>
              <CardDescription>
                {activityData.length} date(s) with activity data
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={selectAllActivity}
              >
                {selectedActivityDates.size === activityData.length ? 'Deselect All' : 'Select All'}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={deleteSelectedActivity}
                disabled={selectedActivityDates.size === 0 || deleting}
              >
                {deleting ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4 mr-1" />
                )}
                Delete Selected ({selectedActivityDates.size})
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {activityData.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              No activity logs found
            </p>
          ) : (
            <div className="space-y-2">
              {activityData.map((dayData) => (
                <div key={dayData.date} className="border rounded-lg">
                  <div className="flex items-center gap-3 p-3">
                    <input
                      type="checkbox"
                      checked={selectedActivityDates.has(dayData.date)}
                      onChange={() => toggleActivityDate(dayData.date)}
                      className="w-4 h-4"
                    />
                    <button
                      onClick={() => setExpandedDate(expandedDate === dayData.date ? null : dayData.date)}
                      className="flex items-center gap-2 flex-1 text-left hover:bg-muted/50 rounded px-2 py-1"
                    >
                      {expandedDate === dayData.date ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                      <div className="flex-1">
                        <div className="font-medium">{formatDate(dayData.date)}</div>
                        <div className="text-sm text-muted-foreground">
                          {dayData.member_count} members • {dayData.total_raids} raids • {formatGold(dayData.total_gold)} gold
                        </div>
                      </div>
                    </button>
                  </div>

                  {expandedDate === dayData.date && (
                    <div className="border-t bg-muted/30 p-4">
                      <div className="mb-3 p-2 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded text-xs text-blue-700 dark:text-blue-300">
                        <strong>Editing Note:</strong> When editing gold values, requirement status is recalculated based only on gold threshold (5k+). The original quantity-based check (50% of challenge items) from initial save is preserved unless gold is changed.
                      </div>
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left border-b">
                            <th className="pb-2">Member</th>
                            <th className="pb-2 text-center">Raids</th>
                            <th className="pb-2 text-right">Gold</th>
                            <th className="pb-2 text-center">Met Req</th>
                            <th className="pb-2 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dayData.logs.map((log) => (
                            <tr key={log.id} className="border-b last:border-0">
                              <td className="py-2">{log.ign}</td>
                              <td className="py-2 text-center">
                                {editingLog?.id === log.id ? (
                                  <Input
                                    type="number"
                                    value={editingLog.raids}
                                    onChange={(e) => setEditingLog({ ...editingLog, raids: parseInt(e.target.value) || 0 })}
                                    className="w-20 h-8"
                                  />
                                ) : (
                                  log.raids
                                )}
                              </td>
                              <td className="py-2 text-right">
                                {editingLog?.id === log.id ? (
                                  <Input
                                    type="number"
                                    value={editingLog.gold}
                                    onChange={(e) => setEditingLog({ ...editingLog, gold: parseInt(e.target.value) || 0 })}
                                    className="w-32 h-8 ml-auto"
                                  />
                                ) : (
                                  formatGold(log.gold_donated)
                                )}
                              </td>
                              <td className="py-2 text-center">
                                {log.met_requirement ? '✓' : '✗'}
                              </td>
                              <td className="py-2 text-right">
                                {editingLog?.id === log.id ? (
                                  <div className="flex gap-1 justify-end">
                                    <Button size="sm" variant="outline" onClick={saveEditLog}>
                                      Save
                                    </Button>
                                    <Button size="sm" variant="ghost" onClick={() => setEditingLog(null)}>
                                      Cancel
                                    </Button>
                                  </div>
                                ) : (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => setEditingLog({ id: log.id, raids: log.raids, gold: log.gold_donated })}
                                  >
                                    <Edit className="h-3 w-3" />
                                  </Button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Challenges Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Challenges</CardTitle>
              <CardDescription>
                {challengeData.length} challenge(s) recorded
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={selectAllChallenges}
              >
                {selectedChallengeDates.size === challengeData.length ? 'Deselect All' : 'Select All'}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={deleteSelectedChallenges}
                disabled={selectedChallengeDates.size === 0 || deleting}
              >
                {deleting ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4 mr-1" />
                )}
                Delete Selected ({selectedChallengeDates.size})
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {challengeData.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              No challenges found
            </p>
          ) : (
            <div className="space-y-2">
              {challengeData.map((challenge) => (
                <div key={challenge.id} className="border rounded-lg p-3">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={selectedChallengeDates.has(challenge.challenge_date)}
                      onChange={() => toggleChallengeDate(challenge.challenge_date)}
                      className="w-4 h-4"
                    />
                    <div className="flex-1">
                      <div className="font-medium">{formatDate(challenge.challenge_date)}</div>
                      <div className="text-sm text-muted-foreground">
                        Total cost: {editingChallenge?.id === challenge.id ? (
                          <Input
                            type="number"
                            value={editingChallenge.total_cost}
                            onChange={(e) => setEditingChallenge({ ...editingChallenge, total_cost: parseInt(e.target.value) || 0 })}
                            className="w-32 h-8 inline-block"
                          />
                        ) : (
                          formatGold(challenge.total_cost)
                        )}
                      </div>
                    </div>
                    {editingChallenge?.id === challenge.id ? (
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" onClick={saveEditChallenge}>
                          Save
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingChallenge(null)}>
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditingChallenge({ id: challenge.id, total_cost: challenge.total_cost })}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function DataManagementPage() {
  return (
    <ProtectedRoute requiredRole="OFFICER">
      <DataManagementContent />
    </ProtectedRoute>
  );
}
