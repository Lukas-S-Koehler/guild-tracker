'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Users, RefreshCw, ChevronDown, ChevronRight, ChevronUp, Check, X, AlertCircle } from 'lucide-react';
import { useApiClient } from '@/lib/api-client';
import { useAuth } from '@/contexts/AuthContext';
import ProtectedRoute from '@/components/ProtectedRoute';

interface GuildStatus {
  id: string;
  name: string;
  nickname: string;
  donation_requirement: number;
  last_fetched_at: string | null;
  last_member_synced_at: string | null;
}

interface GuildMember {
  id: string;
  ign: string;
  position: 'LEADER' | 'DEPUTY' | 'OFFICER' | 'RECRUIT';
  avatar_url: string | null;
  total_level: number;
  guild?: { id: string; name: string; nickname: string };
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

const ROLE_ORDER: Record<string, number> = { LEADER: 1, DEPUTY: 2, OFFICER: 3, RECRUIT: 4 };
const ROLE_COLORS: Record<string, string> = {
  LEADER: 'text-yellow-500',
  DEPUTY: 'text-purple-400',
  OFFICER: 'text-blue-400',
  RECRUIT: 'text-muted-foreground',
};

function timeAgo(iso: string | null): string {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatGold(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toString();
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function SortHeader({
  label, col, sortKey, sortDir, onSort,
}: {
  label: string;
  col: 'role' | 'level' | 'ign';
  sortKey: string;
  sortDir: 'asc' | 'desc';
  onSort: (col: 'role' | 'level' | 'ign') => void;
}) {
  const active = sortKey === col;
  return (
    <button
      onClick={() => onSort(col)}
      className={`flex items-center gap-1 hover:text-foreground transition-colors ${active ? 'text-foreground font-semibold' : ''}`}
    >
      {label}
      <span className="flex flex-col h-4 justify-center">
        {active ? (
          sortDir === 'asc'
            ? <ChevronUp className="h-3.5 w-3.5" />
            : <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <span className="opacity-30 flex flex-col">
            <ChevronUp className="h-2.5 w-2.5 -mb-0.5" />
            <ChevronDown className="h-2.5 w-2.5" />
          </span>
        )}
      </span>
    </button>
  );
}

function MembersPageContent() {
  const { currentGuild, hasRole } = useAuth();
  const [allGuilds, setAllGuilds] = useState<GuildStatus[]>([]);
  const [selectedGuildId, setSelectedGuildId] = useState<string | 'all' | null>(null);
  const [members, setMembers] = useState<GuildMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [expandedMemberId, setExpandedMemberId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<'role' | 'level' | 'ign'>('role');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [memberActivity, setMemberActivity] = useState<Record<string, ActivityDay[]>>({});
  const [loadingActivity, setLoadingActivity] = useState<string | null>(null);
  const api = useApiClient();

  const isOfficer = hasRole('OFFICER');

  // Load all guilds with status
  useEffect(() => {
    api.get('/api/guilds/status').then(r => r.ok ? r.json() : []).then((data: GuildStatus[]) => {
      if (!Array.isArray(data) || data.length === 0) return;
      setAllGuilds(data);
      if (!selectedGuildId) {
        const def = data.find(g => g.id === currentGuild?.guild_id) || data[0];
        setSelectedGuildId(def.id);
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentGuild?.guild_id]);

  const fetchMembers = useCallback(async (guildId: string | 'all') => {
    setLoading(true);
    setError(null);
    setExpandedMemberId(null);
    setMemberActivity({});
    try {
      const res = guildId === 'all'
        ? await api.get('/api/members/list-all')
        : await api.get('/api/members/list', { guildId });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to load members');
      }

      let data = await res.json();
      if (!Array.isArray(data) && Array.isArray(data?.data)) data = data.data;
      if (!Array.isArray(data)) throw new Error('Invalid response');

      setMembers(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (selectedGuildId) fetchMembers(selectedGuildId);
  }, [selectedGuildId, fetchMembers]);

  async function syncMembers() {
    if (!selectedGuildId || selectedGuildId === 'all') return;
    setSyncing(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await api.post('/api/members/sync', {}, { guildId: selectedGuildId });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Sync failed');
      }
      setSuccess('Members synced successfully.');
      await fetchMembers(selectedGuildId);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSyncing(false);
    }
  }

  async function toggleMemberActivity(member: GuildMember) {
    if (expandedMemberId === member.id) {
      setExpandedMemberId(null);
      return;
    }
    setExpandedMemberId(member.id);
    if (memberActivity[member.id]) return;

    // Use the member's own guild ID for the activity history query
    const guildId = member.guild?.id || (selectedGuildId !== 'all' ? selectedGuildId! : undefined);
    if (!guildId) return;

    try {
      setLoadingActivity(member.id);
      const res = await api.get(`/api/members/activity-history?member_id=${member.id}`, { guildId });
      if (!res.ok) return;
      const activity = await res.json();
      setMemberActivity(prev => ({ ...prev, [member.id]: activity }));
    } finally {
      setLoadingActivity(null);
    }
  }

  function handleSort(key: 'role' | 'level' | 'ign') {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  const selectedGuild = allGuilds.find(g => g.id === selectedGuildId);
  const isAllGuilds = selectedGuildId === 'all';
  const colCount = isAllGuilds ? 6 : 5;

  const sortedMembers = [...members].sort((a, b) => {
    const guild = isAllGuilds
      ? (a.guild?.name || '').localeCompare(b.guild?.name || '')
      : 0;
    if (guild !== 0) return guild;

    let cmp = 0;
    if (sortKey === 'role') {
      cmp = (ROLE_ORDER[a.position] || 99) - (ROLE_ORDER[b.position] || 99);
    } else if (sortKey === 'level') {
      cmp = a.total_level - b.total_level;
    } else {
      cmp = a.ign.localeCompare(b.ign);
    }
    return sortDir === 'desc' ? -cmp : cmp;
  });

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Guild Members</h1>
          <p className="text-muted-foreground">Roster synced from IdleMMO</p>
        </div>
        {isOfficer && !isAllGuilds && selectedGuildId && (
          <Button variant="outline" onClick={syncMembers} disabled={syncing}>
            {syncing ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Syncing...</>
            ) : (
              <><RefreshCw className="h-4 w-4 mr-2" />Sync Members</>
            )}
          </Button>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-destructive/10 text-destructive rounded-lg text-sm">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {success && (
        <div className="flex items-center gap-2 p-3 bg-green-500/10 text-green-600 rounded-lg text-sm">
          <Check className="h-4 w-4 flex-shrink-0" />
          {success}
        </div>
      )}

      {/* Guild Tabs */}
      {allGuilds.length > 0 && (
        <div className="flex gap-2 flex-wrap border-b pb-2">
          {allGuilds.map(guild => (
            <button
              key={guild.id}
              onClick={() => setSelectedGuildId(guild.id)}
              className={`px-4 py-2 rounded-t-md text-sm font-medium transition-colors text-left ${
                selectedGuildId === guild.id
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              <div>{guild.name}</div>
              <div className={`text-xs ${selectedGuildId === guild.id ? 'opacity-70' : 'opacity-50'}`}>
                {guild.last_member_synced_at ? `synced ${timeAgo(guild.last_member_synced_at)}` : 'never synced'}
              </div>
            </button>
          ))}
          <button
            onClick={() => setSelectedGuildId('all')}
            className={`px-4 py-2 rounded-t-md text-sm font-medium transition-colors ${
              isAllGuilds
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
          >
            All Guilds
          </button>
        </div>
      )}

      {/* Members Table */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : members.length === 0 && selectedGuildId ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <p>No members found.</p>
            {isOfficer && !isAllGuilds && (
              <p className="text-sm mt-2">Use "Sync Members" to fetch the latest roster from IdleMMO.</p>
            )}
          </CardContent>
        </Card>
      ) : members.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              {isAllGuilds ? 'All Guilds' : selectedGuild?.name} — {members.length} members
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 px-4 w-8"></th>
                    <th className="py-2 px-4 w-12">Avatar</th>
                    <th className="py-2 px-4">
                      <SortHeader label="IGN" col="ign" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    </th>
                    {isAllGuilds && <th className="py-2 px-4">Guild</th>}
                    <th className="py-2 px-4">
                      <SortHeader label="Level" col="level" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    </th>
                    <th className="py-2 px-4">
                      <SortHeader label="Role" col="role" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedMembers.map(member => (
                    <>
                      <tr key={member.id} className="border-b hover:bg-muted/30 transition-colors">
                        <td className="py-2 px-4">
                          <button
                            onClick={() => toggleMemberActivity(member)}
                            className="text-muted-foreground hover:text-foreground"
                          >
                            {expandedMemberId === member.id
                              ? <ChevronDown className="h-4 w-4" />
                              : <ChevronRight className="h-4 w-4" />}
                          </button>
                        </td>
                        <td className="py-2 px-4">
                          {member.avatar_url
                            ? <img src={member.avatar_url} alt={member.ign} className="w-10 h-10 rounded" />
                            : <div className="w-10 h-10 bg-muted rounded" />}
                        </td>
                        <td className="py-2 px-4 font-medium">{member.ign}</td>
                        {isAllGuilds && (
                          <td className="py-2 px-4">
                            <span className="font-mono text-xs font-bold text-primary">
                              {member.guild?.nickname || '-'}
                            </span>
                          </td>
                        )}
                        <td className="py-2 px-4">{member.total_level}</td>
                        <td className="py-2 px-4">
                          <span className={`text-xs font-medium ${ROLE_COLORS[member.position] || ''}`}>
                            {member.position}
                          </span>
                        </td>
                      </tr>
                      {expandedMemberId === member.id && (
                        <tr key={`${member.id}-activity`}>
                          <td colSpan={colCount} className="bg-muted/30 px-4 py-4">
                            {loadingActivity === member.id ? (
                              <div className="flex items-center justify-center py-4">
                                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                              </div>
                            ) : !memberActivity[member.id]?.length ? (
                              <p className="text-center text-muted-foreground py-4">
                                No activity data for last 7 days
                              </p>
                            ) : (
                              <div>
                                <h4 className="text-sm font-semibold mb-3">Last 7 Days Activity</h4>
                                <div className="grid grid-cols-7 gap-2">
                                  {memberActivity[member.id].map((day) => (
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
                                      <div className="text-lg font-bold mb-1">{formatGold(day.total_gold)}</div>
                                      <div className="text-xs text-muted-foreground mb-2">{day.raids} raids</div>
                                      {day.deposits_gold > 0 && (
                                        <div className="text-xs text-blue-500 mb-1">
                                          +{formatGold(day.deposits_gold)} dep
                                        </div>
                                      )}
                                      {day.challenge_total > 0 && (
                                        <div className="text-xs">
                                          <div className="font-medium">{day.challenge_percent}%</div>
                                          <div className="text-muted-foreground">challenge</div>
                                        </div>
                                      )}
                                      <div className="mt-2">
                                        {day.met_requirement
                                          ? <Check className="h-4 w-4 text-green-500 mx-auto" />
                                          : <X className="h-4 w-4 text-red-500 mx-auto" />}
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
          </CardContent>
        </Card>
      ) : null}
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
