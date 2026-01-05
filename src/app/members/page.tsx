'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Users, Settings, RefreshCw, ChevronDown, ChevronRight, Check, X } from 'lucide-react';
import { useApiClient } from '@/lib/api-client';
import { useAuth } from '@/contexts/AuthContext';
import ProtectedRoute from '@/components/ProtectedRoute';

interface GuildMember {
  id: string;
  idlemmo_id: string;
  ign: string;
  position: 'LEADER' | 'DEPUTY' | 'OFFICER' | 'RECRUIT';
  avatar_url: string | null;
  total_level: number;
}

interface ActivityDay {
  date: string;
  gold_donated: number;
  deposits_gold: number;
  total_gold: number;
  raids: number;
  met_requirement: boolean;
  challenge_total: number;
  challenge_percent: number;
}

function MembersPageContent() {
  const { currentGuild } = useAuth();
  const [members, setMembers] = useState<GuildMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedMemberId, setExpandedMemberId] = useState<string | null>(null);
  const [memberActivity, setMemberActivity] = useState<Record<string, ActivityDay[]>>({});
  const [loadingActivity, setLoadingActivity] = useState<string | null>(null);
  const api = useApiClient();

  async function loadMembers() {
    if (!currentGuild) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Load members for the current guild
      const res = await api.get('/api/members/list');

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to load members');
      }

      const raw = await res.text();
      console.log('RAW /api/members/list RESPONSE:', raw);

      let data;
      try {
        data = JSON.parse(raw);
      } catch (err) {
        console.error('Failed to parse JSON from /api/members/list:', err);
        setError('Invalid response from members API');
        setLoading(false);
        return;
      }

      console.log('PARSED DATA TYPE:', Array.isArray(data) ? 'array' : typeof data);
      console.log('PARSED DATA CONTENT:', data);

      // Handle wrapped shape { data: [...] }
      if (!Array.isArray(data) && Array.isArray(data?.data)) {
        console.log('Detected wrapped { data: [...] } shape, unwrapping...');
        data = data.data;
      }

      if (!Array.isArray(data)) {
        setError('Failed to load members from database.');
        setLoading(false);
        return;
      }

      const roleOrder: Record<string, number> = {
        LEADER: 1,
        DEPUTY: 2,
        OFFICER: 3,
        RECRUIT: 4,
      };

      data.sort((a: GuildMember, b: GuildMember) => {
        const roleDiff = roleOrder[a.position] - roleOrder[b.position];
        if (roleDiff !== 0) return roleDiff;
        return b.total_level - a.total_level;
      });

      console.log('SORTED MEMBERS:', data);
      setMembers(data);
      console.log('STATE SET: members length =', data.length);
    } catch (err: any) {
      console.error('loadMembers error:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function syncMembers() {
    if (!currentGuild) return;

    try {
      setSyncing(true);
      setError(null);

      const res = await api.post('/api/members/sync');
      console.log('SYNC RESPONSE STATUS:', res.status);

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to sync members');
      }

      const syncText = await res.text();
      console.log('SYNC RAW RESPONSE:', syncText);

      // Reload members after sync
      await loadMembers();
    } catch (err: any) {
      console.error('syncMembers error:', err);
      setError(err.message || 'Failed to sync members');
    } finally {
      setSyncing(false);
    }
  }

  async function toggleMemberActivity(memberId: string) {
    // If already expanded, collapse
    if (expandedMemberId === memberId) {
      setExpandedMemberId(null);
      return;
    }

    // Expand this member
    setExpandedMemberId(memberId);

    // If we already have activity data, don't fetch again
    if (memberActivity[memberId]) {
      return;
    }

    // Fetch activity for this member
    try {
      setLoadingActivity(memberId);
      const res = await api.get(`/api/members/activity-history?member_id=${memberId}`);

      if (!res.ok) {
        console.error('Failed to load activity for member', memberId);
        return;
      }

      const activity = await res.json();
      setMemberActivity(prev => ({
        ...prev,
        [memberId]: activity,
      }));
    } catch (err) {
      console.error('Error loading member activity:', err);
    } finally {
      setLoadingActivity(null);
    }
  }

  function formatGold(value: number): string {
    if (value >= 1_000_000) {
      return `${(value / 1_000_000).toFixed(1)}M`;
    }
    if (value >= 1_000) {
      return `${(value / 1_000).toFixed(1)}K`;
    }
    return value.toString();
  }

  function formatDate(dateStr: string): string {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  useEffect(() => {
    loadMembers();
  }, [currentGuild?.guild_id]); // Reload when guild changes

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-md mx-auto mt-20">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Members
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-red-500">{error}</p>
            <Button onClick={loadMembers} className="w-full">
              Try Again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{currentGuild?.guild_name} Members</h1>
          <p className="text-muted-foreground">
            View and sync your guild roster from IdleMMO
          </p>
        </div>

        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href="/settings">
              <Settings className="h-4 w-4 mr-2" />
              Settings
            </Link>
          </Button>

          <Button onClick={syncMembers} disabled={syncing}>
            {syncing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Syncing...
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4 mr-2" />
                Sync Members
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Members List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Guild Members ({members.length})
          </CardTitle>
        </CardHeader>

        <CardContent>
          {members.length === 0 ? (
            <div className="text-center py-8 space-y-3">
              <p className="text-muted-foreground">
                No members synced yet. Click "Sync Members" to fetch the latest roster from IdleMMO.
              </p>
              <Button onClick={syncMembers} disabled={syncing}>
                {syncing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
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
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-700 text-left">
                    <th className="py-2 px-3 w-8"></th>
                    <th className="py-2 px-3">Avatar</th>
                    <th className="py-2 px-3">IGN</th>
                    <th className="py-2 px-3">Level</th>
                    <th className="py-2 px-3">Role</th>
                  </tr>
                </thead>

                <tbody>
                  {members.map(member => (
                    <>
                      <tr key={member.id} className="border-b border-gray-800">
                        <td className="py-2 px-3">
                          <button
                            onClick={() => toggleMemberActivity(member.id)}
                            className="text-muted-foreground hover:text-foreground transition-colors"
                          >
                            {expandedMemberId === member.id ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </button>
                        </td>
                        <td className="py-2 px-3">
                          {member.avatar_url ? (
                            <img
                              src={member.avatar_url}
                              alt={member.ign}
                              className="w-10 h-10 rounded"
                            />
                          ) : (
                            <div className="w-10 h-10 bg-gray-700 rounded" />
                          )}
                        </td>

                        <td className="py-2 px-3 font-medium">{member.ign}</td>
                        <td className="py-2 px-3">{member.total_level}</td>
                        <td className="py-2 px-3">{member.position}</td>
                      </tr>

                      {/* Expanded Activity Row */}
                      {expandedMemberId === member.id && (
                        <tr key={`${member.id}-activity`}>
                          <td colSpan={5} className="bg-muted/30 p-4">
                            {loadingActivity === member.id ? (
                              <div className="flex items-center justify-center py-4">
                                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                              </div>
                            ) : memberActivity[member.id]?.length === 0 ? (
                              <p className="text-center text-muted-foreground py-4">
                                No activity data available for the last 7 days
                              </p>
                            ) : (
                              <div>
                                <h4 className="text-sm font-semibold mb-3">Last 7 Days Activity</h4>
                                <div className="grid grid-cols-7 gap-2">
                                  {memberActivity[member.id]?.map((day) => (
                                    <div
                                      key={day.date}
                                      className={`rounded-lg border p-3 text-center ${
                                        day.met_requirement
                                          ? 'bg-green-500/10 border-green-500/30'
                                          : 'bg-muted border-border'
                                      }`}
                                    >
                                      <div className="text-xs font-medium text-muted-foreground mb-1">
                                        {formatDate(day.date)}
                                      </div>
                                      <div className="text-lg font-bold mb-1">
                                        {formatGold(day.total_gold)}
                                      </div>
                                      <div className="text-xs text-muted-foreground mb-2">
                                        {day.raids} raids
                                      </div>
                                      {day.deposits_gold > 0 && (
                                        <div className="text-xs text-blue-500 mb-1">
                                          +{formatGold(day.deposits_gold)} deposits
                                        </div>
                                      )}
                                      {day.challenge_total > 0 && (
                                        <div className="text-xs">
                                          <div className="font-medium">{day.challenge_percent}%</div>
                                          <div className="text-muted-foreground">of challenge</div>
                                        </div>
                                      )}
                                      <div className="mt-2">
                                        {day.met_requirement ? (
                                          <Check className="h-4 w-4 text-green-500 mx-auto" />
                                        ) : (
                                          <X className="h-4 w-4 text-red-500 mx-auto" />
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function MembersPage() {
  return (
    <ProtectedRoute requiredRole="MEMBER">
      <MembersPageContent />
    </ProtectedRoute>
  );
}
