'use client';

import { useState, useEffect, useCallback } from 'react';
import { format, parseISO } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Loader2, Check, AlertCircle, RefreshCw, ChevronDown, ChevronUp, CalendarIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatGold, getLastCompletedDay } from '@/lib/utils';
import { useApiClient } from '@/lib/api-client';
import { useAuth } from '@/contexts/AuthContext';
import ProtectedRoute from '@/components/ProtectedRoute';

interface GuildStatus {
  id: string;
  name: string;
  nickname: string;
  donation_requirement: number;
  last_fetched_at: string | null;
}

interface DonationEntry {
  item_name: string;
  quantity: number;
  unit_price: number;
  gold_value: number;
}

interface ActivityLogEntry {
  id: string;
  log_date: string;
  raids: number;
  gold_donated: number;
  deposits_gold: number;
  met_requirement: boolean;
  log_order: number;
  members: {
    id: string;
    ign: string;
    avatar_url: string | null;
    position: string;
    total_level: number;
    first_seen: string | null;
  } | null;
  donations: DonationEntry[];
}

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

function ActivityPageContent() {
  const { currentGuild, hasRole } = useAuth();
  const [allGuilds, setAllGuilds] = useState<GuildStatus[]>([]);
  const [selectedGuildId, setSelectedGuildId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(getLastCompletedDay());
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [activityLogs, setActivityLogs] = useState<ActivityLogEntry[]>([]);
  const [expandedMembers, setExpandedMembers] = useState<Set<string>>(new Set());
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

  const fetchActivity = useCallback(async (guildId: string, date: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`/api/guild-activity?date=${date}`, { guildId });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to load activity');
      }
      setActivityLogs(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load activity');
      setActivityLogs([]);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (selectedGuildId && selectedDate) {
      fetchActivity(selectedGuildId, selectedDate);
    }
  }, [selectedGuildId, selectedDate, fetchActivity]);

  const handleFetchNow = async () => {
    if (!selectedGuildId) return;
    setFetching(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await api.post('/api/admin/trigger-fetch', {}, { guildId: selectedGuildId });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Fetch failed');
      }
      const data = await res.json();
      setSuccess(`Fetched ${data.stored} events, processed ${data.processed} logs. Reloading...`);
      // Refresh guild status to update last_fetched_at
      api.get('/api/guilds/status').then(r => r.ok ? r.json() : allGuilds).then(setAllGuilds);
      setTimeout(() => {
        fetchActivity(selectedGuildId, selectedDate);
        setSuccess(null);
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fetch failed. Check server logs.');
    } finally {
      setFetching(false);
    }
  };

  const toggleExpanded = (id: string) => {
    setExpandedMembers(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const totalRaids = activityLogs.reduce((s, l) => s + l.raids, 0);
  const totalGold = activityLogs.reduce((s, l) => s + l.gold_donated + (l.deposits_gold || 0), 0);
  const metCount = activityLogs.filter(l => l.met_requirement).length;

  const selectedGuild = allGuilds.find(g => g.id === selectedGuildId);
  const donationReq = selectedGuild?.donation_requirement ?? 5000;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Guild Activity</h1>
          <p className="text-muted-foreground">
            Automated daily activity — fetched via IdleMMO API
          </p>
        </div>
        {isOfficer && (
          <Button variant="outline" onClick={handleFetchNow} disabled={fetching || !selectedGuildId}>
            {fetching ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Fetching...</>
            ) : (
              <><RefreshCw className="h-4 w-4 mr-2" />Fetch Now</>
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
                {guild.last_fetched_at ? timeAgo(guild.last_fetched_at) : 'never fetched'}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Date Picker + Summary */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium">Date</label>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn("w-40 justify-start text-left font-normal", !selectedDate && "text-muted-foreground")}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {selectedDate ? format(parseISO(selectedDate), 'MMM d, yyyy') : 'Pick date'}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={selectedDate ? parseISO(selectedDate) : undefined}
                onSelect={(date) => date && setSelectedDate(format(date, 'yyyy-MM-dd'))}
                disabled={(date) => date > new Date()}
              />
            </PopoverContent>
          </Popover>
        </div>
        {activityLogs.length > 0 && (
          <div className="flex gap-4 text-sm text-muted-foreground">
            <span>{activityLogs.length} members</span>
            <span>{totalRaids} raids</span>
            <span>{formatGold(totalGold)} gold</span>
            <span className="text-green-600">{metCount}/{activityLogs.length} met req</span>
          </div>
        )}
      </div>

      {/* Activity Table */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : activityLogs.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <p>No activity data for {selectedDate}.</p>
            <p className="text-sm mt-2">
              Activity is fetched automatically daily at 12:00 CET.
              {isOfficer && ' Use "Fetch Now" to trigger an immediate fetch.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>{selectedGuild?.name} — {selectedDate}</CardTitle>
              <div className="text-sm text-muted-foreground">
                Req: {formatGold(donationReq)}
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {activityLogs.map((log) => {
                const ign = log.members?.ign || 'Unknown';
                const totalLogGold = log.gold_donated + (log.deposits_gold || 0);
                const isExpanded = expandedMembers.has(log.id);
                const regularDonations = log.donations.filter(d => !d.item_name.startsWith('[DEPOSIT]'));
                const deposits = log.donations.filter(d => d.item_name.startsWith('[DEPOSIT]'));

                return (
                  <div key={log.id}>
                    <div
                      className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors"
                      onClick={() => toggleExpanded(log.id)}
                    >
                      <button className="text-muted-foreground">
                        {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </button>
                      <div className="flex-1 grid grid-cols-4 gap-4 items-center">
                        <span className="font-medium">{ign}</span>
                        <span className="text-center text-sm text-muted-foreground">
                          {log.raids} {log.raids === 1 ? 'raid' : 'raids'}
                        </span>
                        <span className="text-right text-sm">
                          {formatGold(totalLogGold)}
                          {log.deposits_gold > 0 && (
                            <span className="text-xs text-muted-foreground ml-1">
                              (+{formatGold(log.deposits_gold)} dep)
                            </span>
                          )}
                        </span>
                        <div className="text-right">
                          <Badge variant={log.met_requirement ? 'success' : 'secondary'}>
                            {log.met_requirement ? '✓ Met' : 'Not Met'}
                          </Badge>
                        </div>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="px-4 pb-4 bg-muted/30 space-y-3">
                        <div className="grid grid-cols-3 gap-4 text-sm pt-3">
                          <div>
                            <span className="text-muted-foreground">Challenge Donations:</span>
                            <span className="ml-2 font-medium">{formatGold(log.gold_donated)}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Guild Hall Deposits:</span>
                            <span className="ml-2 font-medium text-blue-600">{formatGold(log.deposits_gold || 0)}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Total:</span>
                            <span className={`ml-2 font-medium ${totalLogGold >= donationReq ? 'text-green-600' : 'text-amber-600'}`}>
                              {formatGold(totalLogGold)} / {formatGold(donationReq)}
                            </span>
                          </div>
                        </div>

                        {regularDonations.length > 0 && (
                          <div>
                            <p className="text-xs font-medium text-muted-foreground mb-1">Challenge Items</p>
                            <div className="space-y-1">
                              {regularDonations.map((d, i) => (
                                <div key={i} className="flex justify-between text-xs">
                                  <span>{d.item_name}</span>
                                  <span className="text-muted-foreground">
                                    {d.quantity.toLocaleString()} × {formatGold(d.unit_price)} = {formatGold(d.gold_value)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {deposits.length > 0 && (
                          <div>
                            <p className="text-xs font-medium text-muted-foreground mb-1">Guild Hall Deposits</p>
                            <div className="space-y-1">
                              {deposits.map((d, i) => (
                                <div key={i} className="flex justify-between text-xs">
                                  <span>{d.item_name.replace('[DEPOSIT] ', '')}</span>
                                  <span className="text-muted-foreground">
                                    {d.quantity.toLocaleString()} × {formatGold(d.unit_price)} = {formatGold(d.gold_value)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {log.members?.first_seen && (
                          <p className="text-xs text-muted-foreground">
                            Member since: {new Date(log.members.first_seen).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function ActivityPage() {
  return (
    <ProtectedRoute requiredRole="MEMBER">
      <ActivityPageContent />
    </ProtectedRoute>
  );
}
