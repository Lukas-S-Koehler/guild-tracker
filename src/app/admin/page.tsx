'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, UserPlus, Trash2, Shield, Crown, Users, AlertCircle, Check, ChevronDown, ChevronRight, Settings, RefreshCw } from 'lucide-react';
import { useApiClient } from '@/lib/api-client';
import { useAuth } from '@/contexts/AuthContext';
import ProtectedRoute from '@/components/ProtectedRoute';

interface GuildMember {
  user_id: string;
  email: string;
  display_name: string;
  role: 'MEMBER' | 'OFFICER' | 'DEPUTY' | 'LEADER';
  joined_at: string;
}

interface Guild {
  id: string;
  name: string;
  nickname: string;
  min_level: number;
  is_active: boolean;
  display_order: number;
  members: GuildMember[];
  leader?: GuildMember;
  deputy?: GuildMember;
  officers: GuildMember[];
  member_count: number;
}

interface GuildSettings {
  api_key: string;
  donation_requirement: number;
  active_buildings: string[];
  requirement_period: 'daily' | 'weekly';
  weekly_donation_requirement: number;
  deposits_only: boolean;
  discord_log_channel_id: string;
  discord_server_id: string;
  guild_hall_channel_id: string;
  overflow_enabled: boolean;
  overflow_limit: number;
}

interface Building {
  id: string;
  name: string;
}


function GuildSettingsSection({ guildId, guildName, currentMinLevel, currentIsActive }: { guildId: string; guildName: string; currentMinLevel: number; currentIsActive: boolean }) {
  const api = useApiClient();
  const { currentGuild, isSuperAdmin } = useAuth();
  const isLeaderOfThisGuild = isSuperAdmin || currentGuild?.guild_id === guildId;
  const [settings, setSettings] = useState<GuildSettings>({
    api_key: '',
    donation_requirement: 5000,
    active_buildings: [],
    requirement_period: 'daily',
    weekly_donation_requirement: 35000,
    deposits_only: false,
    discord_log_channel_id: '',
    discord_server_id: '',
    guild_hall_channel_id: '',
    overflow_enabled: true,
    overflow_limit: 10000,
  });
  const [minLevel, setMinLevel] = useState<number>(currentMinLevel);
  const [isActive, setIsActive] = useState<boolean>(currentIsActive);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [backfillingBank, setBackfillingBank] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [configRes, buildingsRes] = await Promise.all([
          api.get('/api/config', { guildId }),
          api.get('/api/guild-buildings', { guildId }),
        ]);

        if (configRes.ok) {
          const data = await configRes.json();
          setSettings({
            api_key: data.api_key || '',
            donation_requirement: data.donation_requirement ?? 5000,
            active_buildings: data.settings?.active_buildings || [],
            requirement_period: data.settings?.requirement_period ?? 'daily',
            weekly_donation_requirement: data.settings?.weekly_donation_requirement ?? 35000,
            deposits_only: data.settings?.deposits_only ?? false,
            discord_log_channel_id: data.settings?.discord_log_channel_id ?? '',
            discord_server_id: data.settings?.discord_server_id ?? '',
            guild_hall_channel_id: data.settings?.guild_hall_channel_id ?? '',
            overflow_enabled: data.settings?.overflow_enabled ?? true,
            overflow_limit: data.settings?.overflow_limit ?? 10000,
          });
        }

        if (buildingsRes.ok) {
          const data = await buildingsRes.json();
          setBuildings(Array.isArray(data) ? data : []);
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [api, guildId]);

  const showMsg = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 4000);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const [configRes, metaRes] = await Promise.all([
        api.post('/api/config', {
          guild_name: guildName,
          guild_id: guildId,
          api_key: settings.api_key || 'placeholder',
          donation_requirement: settings.donation_requirement,
          settings: {
            donation_requirement: settings.donation_requirement,
            active_buildings: settings.active_buildings,
            requirement_period: settings.requirement_period,
            weekly_donation_requirement: settings.weekly_donation_requirement,
            deposits_only: settings.deposits_only,
            discord_log_channel_id: settings.discord_log_channel_id || null,
            discord_server_id: settings.discord_server_id || null,
            guild_hall_channel_id: settings.guild_hall_channel_id || null,
            overflow_enabled: settings.overflow_enabled,
            overflow_limit: settings.overflow_limit,
          },
        }, { guildId }),
        api.patch('/api/admin/guild-meta', { guild_id: guildId, min_level: minLevel, is_active: isActive }, { guildId }),
      ]);

      if (!configRes.ok) {
        const data = await configRes.json();
        throw new Error(data.error || 'Failed to save config');
      }
      if (!metaRes.ok) {
        const data = await metaRes.json();
        throw new Error(data.error || 'Failed to save guild meta');
      }
      showMsg('success', 'Settings saved');
    } catch (err) {
      showMsg('error', err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleSyncMembers = async () => {
    setSyncing(true);
    try {
      const res = await api.post('/api/members/sync', {}, { guildId });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Sync failed');
      }
      const data = await res.json();
      showMsg('success', `Synced ${data.synced} members`);
    } catch (err) {
      showMsg('error', err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const handleBackfillBank = async () => {
    setBackfillingBank(true);
    try {
      const res = await api.post('/api/admin/backfill-bank', { guild_id: guildId }, { guildId });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Backfill failed');
      }
      const data = await res.json();
      const r = data.results?.[0];
      showMsg('success', `Bank backfilled: ${r?.logsUpdated ?? 0} logs updated across ${r?.members ?? 0} members`);
    } catch (err) {
      showMsg('error', err instanceof Error ? err.message : 'Backfill failed');
    } finally {
      setBackfillingBank(false);
    }
  };

  const toggleBuilding = (buildingId: string) => {
    setSettings(prev => ({
      ...prev,
      active_buildings: prev.active_buildings.includes(buildingId)
        ? prev.active_buildings.filter(id => id !== buildingId)
        : [...prev.active_buildings, buildingId],
    }));
  };

  if (loading) {
    return <div className="py-4 flex justify-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-4 p-4 border rounded-lg bg-muted/30">
      <h3 className="font-semibold flex items-center gap-2 text-sm">
        <Settings className="h-4 w-4" />
        Guild Settings
      </h3>

      {message && (
        <div className={`flex items-center gap-2 p-2 rounded text-sm ${message.type === 'success' ? 'bg-green-500/10 text-green-600' : 'bg-destructive/10 text-destructive'}`}>
          {message.type === 'success' ? <Check className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
          {message.text}
        </div>
      )}

      <div className="grid gap-3">
        {isLeaderOfThisGuild && (
          <div>
            <Label className="text-xs text-muted-foreground">IdleMMO API Key (for automated fetching)</Label>
            <Input
              type="password"
              value={settings.api_key}
              onChange={e => setSettings(prev => ({ ...prev, api_key: e.target.value }))}
              placeholder="Enter API key..."
              className="mt-1"
            />
          </div>
        )}

        <div>
          <Label className="text-xs text-muted-foreground">Donation Requirement (gold)</Label>
          <Input
            type="number"
            value={settings.donation_requirement}
            onChange={e => setSettings(prev => ({ ...prev, donation_requirement: e.target.value === '' ? 0 : (parseInt(e.target.value) || 0) }))}
            className="mt-1 w-40"
          />
        </div>

        <div>
          <Label className="text-xs text-muted-foreground">Min Level Required</Label>
          <Input
            type="number"
            value={minLevel}
            onChange={e => setMinLevel(parseInt(e.target.value) || 0)}
            className="mt-1 w-40"
          />
        </div>

        <div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isActive}
              onChange={e => setIsActive(e.target.checked)}
              className="rounded"
            />
            <span className="text-sm">Guild is active</span>
          </label>
          <p className="text-xs text-muted-foreground mt-0.5">Inactive guilds are visually marked in the UI</p>
        </div>

        <div>
          <Label className="text-xs text-muted-foreground">Activity Requirement Period</Label>
          <div className="flex gap-3 mt-1">
            {(['daily', 'weekly'] as const).map(p => (
              <label key={p} className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input
                  type="radio"
                  name={`period-${guildId}`}
                  value={p}
                  checked={settings.requirement_period === p}
                  onChange={() => setSettings(prev => ({ ...prev, requirement_period: p }))}
                />
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </label>
            ))}
          </div>
        </div>

        {settings.requirement_period === 'weekly' && (
          <>
            <div>
              <Label className="text-xs text-muted-foreground">Weekly Requirement (gold)</Label>
              <Input
                type="number"
                value={settings.weekly_donation_requirement}
                onChange={e => setSettings(prev => ({ ...prev, weekly_donation_requirement: parseInt(e.target.value) || 0 }))}
                className="mt-1 w-40"
              />
            </div>
            <div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.deposits_only}
                  onChange={e => setSettings(prev => ({ ...prev, deposits_only: e.target.checked }))}
                  className="rounded"
                />
                <span className="text-sm">Stockpile deposits only (no challenge donations)</span>
              </label>
            </div>
          </>
        )}

        <div className="border rounded-lg p-3 space-y-3 bg-muted/20">
          <p className="text-xs font-medium text-foreground">Overflow Bank</p>
          <div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.overflow_enabled}
                onChange={e => setSettings(prev => ({ ...prev, overflow_enabled: e.target.checked }))}
                className="rounded"
              />
              <span className="text-sm">Enable overflow bank</span>
            </label>
            <p className="text-xs text-muted-foreground mt-0.5">Gold above daily req is banked and used to cover future shortfalls</p>
          </div>
          {settings.overflow_enabled && (
            <div>
              <Label className="text-xs text-muted-foreground">Bank limit (gold)</Label>
              <Input
                type="number"
                value={settings.overflow_limit}
                onChange={e => setSettings(prev => ({ ...prev, overflow_limit: parseInt(e.target.value) || 0 }))}
                className="mt-1 w-40"
                min={0}
              />
            </div>
          )}
        </div>

        <div>
          <Label className="text-xs text-muted-foreground">Discord Log Channel ID (for auto-warn summaries)</Label>
          <Input
            value={settings.discord_log_channel_id}
            onChange={e => setSettings(prev => ({ ...prev, discord_log_channel_id: e.target.value }))}
            placeholder="Channel snowflake ID"
            className="mt-1"
          />
        </div>

        <div>
          <Label className="text-xs text-muted-foreground">Discord Server ID</Label>
          <Input
            value={settings.discord_server_id}
            onChange={e => setSettings(prev => ({ ...prev, discord_server_id: e.target.value }))}
            placeholder="Server snowflake ID"
            className="mt-1"
          />
        </div>

        <div>
          <Label className="text-xs text-muted-foreground">Guild Hall Stockpile Channel ID (daily hall message)</Label>
          <Input
            value={settings.guild_hall_channel_id}
            onChange={e => setSettings(prev => ({ ...prev, guild_hall_channel_id: e.target.value }))}
            placeholder="Channel snowflake ID"
            className="mt-1"
          />
        </div>

        {buildings.length > 0 && (
          <div>
            <Label className="text-xs text-muted-foreground">Active Buildings (valid deposit items)</Label>
            <div className="mt-1 grid grid-cols-2 gap-2">
              {buildings.map(b => (
                <label key={b.id} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.active_buildings.includes(b.id)}
                    onChange={() => toggleBuilding(b.id)}
                    className="rounded"
                  />
                  {b.name}
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2 pt-2">
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
          Save Settings
        </Button>
        <Button size="sm" variant="outline" onClick={handleSyncMembers} disabled={syncing}>
          {syncing ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
          Sync Members
        </Button>
        {settings.overflow_enabled && (
          <Button size="sm" variant="outline" onClick={handleBackfillBank} disabled={backfillingBank}>
            {backfillingBank ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
            Backfill Bank History
          </Button>
        )}
      </div>
    </div>
  );
}

interface GuildMemberDiscord {
  id: string;
  ign: string;
  discord_id: string | null;
  discord_username: string | null;
}

function DiscordMappingSection({ guildId }: { guildId: string }) {
  const api = useApiClient();
  const [members, setMembers] = useState<GuildMemberDiscord[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Record<string, { discord_id: string; discord_username: string }>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await api.get('/api/members/list', { guildId });
        if (res.ok) {
          const data = await res.json();
          setMembers(Array.isArray(data) ? data : []);
        }
      } catch { /* ignore */ }
      finally { setLoading(false); }
    }
    load();
  }, [api, guildId]);

  const handleEdit = (memberId: string, field: 'discord_id' | 'discord_username', value: string) => {
    setEditing(prev => ({
      ...prev,
      [memberId]: {
        discord_id: prev[memberId]?.discord_id ?? (members.find(m => m.id === memberId)?.discord_id ?? ''),
        discord_username: prev[memberId]?.discord_username ?? (members.find(m => m.id === memberId)?.discord_username ?? ''),
        [field]: value,
      },
    }));
  };

  const handleSave = async (memberId: string) => {
    const vals = editing[memberId];
    if (!vals) return;
    setSaving(memberId);
    try {
      const res = await api.patch(`/api/members/list?member_id=${memberId}`, {
        discord_id: vals.discord_id || null,
        discord_username: vals.discord_username || null,
      }, { guildId });
      if (res.ok) {
        setMembers(prev => prev.map(m => m.id === memberId ? { ...m, ...vals } : m));
        setEditing(prev => { const n = { ...prev }; delete n[memberId]; return n; });
        setMessage({ type: 'success', text: 'Discord mapping saved' });
        setTimeout(() => setMessage(null), 3000);
      } else {
        const d = await res.json();
        setMessage({ type: 'error', text: d.error || 'Save failed' });
      }
    } catch { setMessage({ type: 'error', text: 'Network error' }); }
    finally { setSaving(null); }
  };

  if (loading) return <div className="py-2 flex justify-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>;

  const mapped = members.filter(m => m.discord_id).length;

  return (
    <div className="space-y-3 p-4 border rounded-lg bg-muted/30">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">Discord Member Mapping</h3>
        <span className="text-xs text-muted-foreground">{mapped}/{members.length} mapped</span>
      </div>
      {message && (
        <div className={`text-xs p-2 rounded ${message.type === 'success' ? 'bg-green-500/10 text-green-600' : 'bg-destructive/10 text-destructive'}`}>
          {message.text}
        </div>
      )}
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {members.map(m => {
          const ed = editing[m.id];
          const discordId = ed?.discord_id ?? m.discord_id ?? '';
          const discordUser = ed?.discord_username ?? m.discord_username ?? '';
          const hasEdit = !!ed;
          return (
            <div key={m.id} className="flex items-center gap-2 text-sm">
              <span className="w-28 shrink-0 font-medium truncate">{m.ign}</span>
              <input
                className="flex-1 px-2 py-1 rounded border bg-background text-xs"
                placeholder="Discord ID (snowflake)"
                value={discordId}
                onChange={e => handleEdit(m.id, 'discord_id', e.target.value)}
              />
              <input
                className="flex-1 px-2 py-1 rounded border bg-background text-xs"
                placeholder="Username"
                value={discordUser}
                onChange={e => handleEdit(m.id, 'discord_username', e.target.value)}
              />
              {hasEdit && (
                <Button size="sm" className="h-6 text-xs px-2" onClick={() => handleSave(m.id)} disabled={saving === m.id}>
                  {saving === m.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                </Button>
              )}
              {!hasEdit && m.discord_id && (
                <Check className="h-3 w-3 text-green-500 shrink-0" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface AltInfo {
  member_id: string;
  alt_ign: string;
  alt_hashed_id: string;
  alt_member_id: string | null;
  fetched_at: string;
  alt_member?: { ign: string; current_guild_id: string };
}

function AltCharactersSection({ guildId }: { guildId: string }) {
  const api = useApiClient();
  const [alts, setAlts] = useState<AltInfo[]>([]);
  const [members, setMembers] = useState<GuildMemberDiscord[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [altRes, memberRes] = await Promise.all([
        api.get('/api/members/alts', { guildId }),
        api.get('/api/members/list', { guildId }),
      ]);
      if (altRes.ok) setAlts(await altRes.json());
      if (memberRes.ok) {
        const d = await memberRes.json();
        setMembers(Array.isArray(d) ? d : []);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [api, guildId]);

  useEffect(() => { load(); }, [load]);

  const handleSyncAlts = async () => {
    setSyncing(true);
    setMessage(null);
    try {
      const res = await api.post('/api/members/alts', {}, { guildId });
      const data = await res.json();
      if (res.ok) {
        setMessage(`Synced: ${data.processed} processed, ${data.alts_found} alts found${data.errors?.length ? `, ${data.errors.length} errors` : ''}`);
        await load();
      } else {
        setMessage(data.error || 'Sync failed');
      }
    } catch { setMessage('Network error'); }
    finally { setSyncing(false); }
  };

  const handleBackfillHashedIds = async () => {
    setBackfilling(true);
    setMessage(null);
    try {
      const res = await api.post('/api/admin/backfill-hashed-ids', {}, { guildId });
      const data = await res.json();
      if (res.ok) {
        setMessage(`Backfilled ${data.updated} hashed IDs out of ${data.total_members} members`);
      } else {
        setMessage(data.error || 'Backfill failed');
      }
    } catch { setMessage('Network error'); }
    finally { setBackfilling(false); }
  };

  const memberMap = new Map(members.map(m => [m.id, m]));
  const altsByMember = new Map<string, AltInfo[]>();
  for (const alt of alts) {
    const arr = altsByMember.get(alt.member_id) ?? [];
    arr.push(alt);
    altsByMember.set(alt.member_id, arr);
  }

  const membersWithAlts = members.filter(m => altsByMember.has(m.id));
  const membersWithHashedId = members.filter(m => !!(m as unknown as { hashed_id: string | null }).hashed_id).length;

  if (loading) return <div className="py-2 flex justify-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-3 p-4 border rounded-lg bg-muted/30">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-semibold text-sm">Alt Characters</h3>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={handleBackfillHashedIds} disabled={backfilling} className="h-7 text-xs">
            {backfilling ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
            Backfill Hashed IDs
          </Button>
          <Button size="sm" variant="outline" onClick={handleSyncAlts} disabled={syncing} className="h-7 text-xs">
            {syncing ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
            Sync Alts
          </Button>
        </div>
      </div>
      {message && <p className="text-xs text-muted-foreground">{message}</p>}
      <div className="flex items-center gap-2 flex-wrap">
        {membersWithHashedId === members.length ? (
          <span className="inline-flex items-center gap-1 text-xs text-green-500 font-medium">
            <Check className="h-3 w-3" /> Setup complete
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs text-amber-500 font-medium">
            <AlertCircle className="h-3 w-3" /> {members.length - membersWithHashedId} member{members.length - membersWithHashedId !== 1 ? 's' : ''} missing hashed ID
          </span>
        )}
        <span className="text-xs text-muted-foreground">·</span>
        <span className="text-xs text-muted-foreground">{membersWithAlts.length} with known alts</span>
      </div>
      {membersWithAlts.length > 0 && (
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {membersWithAlts.map(m => {
            const memberAlts = altsByMember.get(m.id) ?? [];
            return (
              <div key={m.id} className="text-xs flex items-start gap-2">
                <span className="font-medium w-24 shrink-0 truncate">{m.ign}</span>
                <div className="flex flex-wrap gap-1">
                  {memberAlts.map(a => {
                    const altMember = a.alt_member_id ? memberMap.get(a.alt_member_id) : null;
                    return (
                      <span key={a.alt_hashed_id} className={`px-1.5 py-0.5 rounded text-xs ${altMember ? 'bg-blue-500/20 text-blue-400' : 'bg-muted text-muted-foreground'}`}>
                        {a.alt_ign}{altMember ? ' ✓' : ''}
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface MemberOverviewRow {
  id: string;
  ign: string;
  guild_id: string;
  guild_name: string;
  guild_nickname: string;
  hashed_id: string | null;
  discord_id: string | null;
  alts_found: number;
  alts_matched: number;
}

interface GuildOverviewStat {
  guild_id: string;
  guild_name: string;
  guild_nickname: string;
  total: number;
  with_hashed_id: number;
  without_hashed_id: number;
  with_alts: number;
}

interface OverviewData {
  members: MemberOverviewRow[];
  guild_stats: GuildOverviewStat[];
  totals: { members: number; with_hashed_id: number; without_hashed_id: number; with_alts: number; alts_matched: number };
}

function SuperAdminPanel() {
  const [backfilling, setBackfilling] = useState(false);
  const [syncingAlts, setSyncingAlts] = useState(false);
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [showOverview, setShowOverview] = useState(false);
  const [overviewFilter, setOverviewFilter] = useState<'all' | 'missing' | 'alts'>('all');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [pauseDiscordDMs, setPauseDiscordDMs] = useState<boolean | null>(null);
  const [togglingPause, setTogglingPause] = useState(false);
  const [disableGuildPings, setDisableGuildPings] = useState<boolean | null>(null);
  const [togglingPings, setTogglingPings] = useState(false);

  const showMsg = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 8000);
  };

  useEffect(() => {
    fetch('/api/admin/app-settings')
      .then(r => r.json())
      .then(d => {
        setPauseDiscordDMs(d.pause_discord_dms === 'true');
        setDisableGuildPings(d.disable_guild_pings === 'true');
      })
      .catch(() => { setPauseDiscordDMs(false); setDisableGuildPings(false); });
  }, []);

  const handleTogglePause = async () => {
    setTogglingPause(true);
    const next = !pauseDiscordDMs;
    try {
      const res = await fetch('/api/admin/app-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'pause_discord_dms', value: String(next) }),
      });
      if (res.ok) {
        setPauseDiscordDMs(next);
        showMsg('success', next ? 'Discord DMs paused — cron will log warnings but not DM members' : 'Discord DMs resumed');
      } else {
        const d = await res.json();
        showMsg('error', d.error || 'Failed to update setting');
      }
    } catch { showMsg('error', 'Network error'); }
    finally { setTogglingPause(false); }
  };

  const handleToggleGuildPings = async () => {
    setTogglingPings(true);
    const next = !disableGuildPings;
    try {
      const res = await fetch('/api/admin/app-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'disable_guild_pings', value: String(next) }),
      });
      if (res.ok) {
        setDisableGuildPings(next);
        showMsg('success', next ? 'Guild channel pings disabled — reports will not @mention members' : 'Guild channel pings re-enabled');
      } else {
        const d = await res.json();
        showMsg('error', d.error || 'Failed to update setting');
      }
    } catch { showMsg('error', 'Network error'); }
    finally { setTogglingPings(false); }
  };

  const loadOverview = async () => {
    setLoadingOverview(true);
    try {
      const res = await fetch('/api/admin/hashed-id-overview');
      const data = await res.json();
      if (res.ok) {
        setOverview(data);
        setShowOverview(true);
      } else {
        showMsg('error', data.error || 'Failed to load overview');
      }
    } catch { showMsg('error', 'Network error'); }
    finally { setLoadingOverview(false); }
  };

  const handleBackfillAll = async () => {
    if (!confirm('Backfill hashed IDs for ALL guilds? Calls IdleMMO API for each guild — may take a few minutes.')) return;
    setBackfilling(true);
    try {
      const res = await fetch('/api/admin/backfill-hashed-ids', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      const data = await res.json();
      if (res.ok) {
        const msg = `Updated ${data.updated} hashed IDs. Still missing: ${data.still_missing}${data.still_missing > 0 ? ` (${data.still_missing_names?.slice(0, 5).join(', ')}${data.still_missing > 5 ? '…' : ''})` : ''}`;
        showMsg('success', msg);
        if (showOverview) await loadOverview();
      } else {
        showMsg('error', data.error || 'Backfill failed');
      }
    } catch { showMsg('error', 'Network error'); }
    finally { setBackfilling(false); }
  };

  const handleSyncAltsAll = async () => {
    if (!confirm('Sync alt characters for ALL members with a hashed ID? Calls IdleMMO API per member — may take several minutes.')) return;
    setSyncingAlts(true);
    try {
      const res = await fetch('/api/admin/sync-alts-all', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      const data = await res.json();
      if (res.ok) {
        showMsg('success', `Processed ${data.processed}/${data.total_members_with_hashed_id} members, ${data.alts_found} alts found${data.error_count > 0 ? `, ${data.error_count} errors` : ''}`);
        if (showOverview) await loadOverview();
      } else {
        showMsg('error', data.error || 'Sync failed');
      }
    } catch { showMsg('error', 'Network error'); }
    finally { setSyncingAlts(false); }
  };

  const filteredMembers = overview?.members.filter(m => {
    if (overviewFilter === 'missing') return !m.hashed_id;
    if (overviewFilter === 'alts') return m.alts_found > 0;
    return true;
  }) ?? [];

  return (
    <Card className="border-yellow-500/30 bg-yellow-500/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Crown className="h-4 w-4 text-yellow-500" />
          Super Admin — All Guilds
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {message && (
          <div className={`flex items-start gap-2 p-2 rounded text-sm ${message.type === 'success' ? 'bg-green-500/10 text-green-600' : 'bg-destructive/10 text-destructive'}`}>
            {message.type === 'success' ? <Check className="h-3 w-3 shrink-0 mt-0.5" /> : <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" />}
            {message.text}
          </div>
        )}

        <div className="flex items-center justify-between p-3 border rounded-lg bg-background">
          <div>
            <p className="text-sm font-medium flex items-center gap-2">
              Pause Discord DMs
              {pauseDiscordDMs && <Badge variant="outline" className="text-xs bg-orange-500/10 text-orange-500 border-orange-500/50">PAUSED</Badge>}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">When paused, auto-warn cron logs warnings to DB and posts channel reports but skips member DMs</p>
          </div>
          <Button
            size="sm"
            variant={pauseDiscordDMs ? 'default' : 'outline'}
            onClick={handleTogglePause}
            disabled={togglingPause || pauseDiscordDMs === null}
            className={pauseDiscordDMs ? 'bg-orange-500 hover:bg-orange-600' : ''}
          >
            {togglingPause ? <Loader2 className="h-3 w-3 animate-spin" /> : pauseDiscordDMs ? 'Resume DMs' : 'Pause DMs'}
          </Button>
        </div>

        <div className="flex items-center justify-between p-3 border rounded-lg bg-background">
          <div>
            <p className="text-sm font-medium flex items-center gap-2">
              Disable Guild Channel Pings
              {disableGuildPings && <Badge variant="outline" className="text-xs bg-orange-500/10 text-orange-500 border-orange-500/50">DISABLED</Badge>}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">When disabled, inactivity reports in guild channels will not @mention members</p>
          </div>
          <Button
            size="sm"
            variant={disableGuildPings ? 'default' : 'outline'}
            onClick={handleToggleGuildPings}
            disabled={togglingPings || disableGuildPings === null}
            className={disableGuildPings ? 'bg-orange-500 hover:bg-orange-600' : ''}
          >
            {togglingPings ? <Loader2 className="h-3 w-3 animate-spin" /> : disableGuildPings ? 'Enable Pings' : 'Disable Pings'}
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={handleBackfillAll} disabled={backfilling || syncingAlts}>
            {backfilling ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
            Backfill All Hashed IDs
          </Button>
          <Button size="sm" variant="outline" onClick={handleSyncAltsAll} disabled={syncingAlts || backfilling}>
            {syncingAlts ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
            Sync All Alts
          </Button>
          <Button size="sm" variant="outline" onClick={showOverview ? () => setShowOverview(false) : loadOverview} disabled={loadingOverview}>
            {loadingOverview ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
            {showOverview ? 'Hide Overview' : 'Show Overview'}
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          Uses your IdleMMO API key. Run Backfill first, then Sync Alts.
        </p>

        {showOverview && overview && (
          <div className="space-y-4">
            {/* Totals */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {[
                { label: 'Members', value: overview.totals.members, color: '' },
                { label: 'Hashed ID', value: overview.totals.with_hashed_id, color: 'text-green-500' },
                { label: 'Missing ID', value: overview.totals.without_hashed_id, color: overview.totals.without_hashed_id > 0 ? 'text-orange-400' : 'text-green-500' },
                { label: 'Have Alts', value: overview.totals.with_alts, color: 'text-blue-400' },
                { label: 'Alts Matched', value: overview.totals.alts_matched, color: 'text-blue-400' },
              ].map(s => (
                <div key={s.label} className="p-2 border rounded bg-background text-center">
                  <div className={`text-xl font-bold ${s.color}`}>{s.value}</div>
                  <div className="text-xs text-muted-foreground">{s.label}</div>
                </div>
              ))}
            </div>

            {/* Per-guild stats */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Per Guild</p>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {overview.guild_stats.map(g => (
                  <div key={g.guild_id} className="flex items-center gap-2 text-xs py-1 border-b border-border/50">
                    <span className="font-mono font-bold text-primary w-12 shrink-0">{g.guild_nickname || g.guild_id}</span>
                    <span className="text-muted-foreground w-32 truncate shrink-0">{g.guild_name}</span>
                    <span className="text-green-500 shrink-0">{g.with_hashed_id}✓</span>
                    {g.without_hashed_id > 0 && <span className="text-orange-400 shrink-0">{g.without_hashed_id} missing</span>}
                    {g.with_alts > 0 && <span className="text-blue-400 shrink-0">{g.with_alts} alts</span>}
                    <div className="flex-1 bg-muted rounded-full h-1.5">
                      <div
                        className="bg-green-500 h-1.5 rounded-full"
                        style={{ width: `${Math.round((g.with_hashed_id / g.total) * 100)}%` }}
                      />
                    </div>
                    <span className="text-muted-foreground shrink-0">{Math.round((g.with_hashed_id / g.total) * 100)}%</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Member list */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <p className="text-xs font-medium text-muted-foreground">Members</p>
                <div className="flex gap-1">
                  {(['all', 'missing', 'alts'] as const).map(f => (
                    <button
                      key={f}
                      onClick={() => setOverviewFilter(f)}
                      className={`px-2 py-0.5 rounded text-xs ${overviewFilter === f ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
                    >
                      {f === 'all' ? `All (${overview.members.length})` : f === 'missing' ? `Missing ID (${overview.totals.without_hashed_id})` : `Has Alts (${overview.totals.with_alts})`}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-0.5 max-h-64 overflow-y-auto">
                {filteredMembers.map(m => (
                  <div key={m.id} className="flex items-center gap-2 text-xs py-1 px-1 rounded hover:bg-muted/50">
                    <span className={`h-2 w-2 rounded-full shrink-0 ${m.hashed_id ? 'bg-green-500' : 'bg-orange-400'}`} />
                    <span className="font-medium w-28 truncate shrink-0">{m.ign}</span>
                    <span className="text-muted-foreground w-16 truncate shrink-0 font-mono">{m.guild_nickname || m.guild_id}</span>
                    {m.hashed_id
                      ? <span className="text-green-500/70 font-mono text-[10px] truncate flex-1">{m.hashed_id.slice(0, 12)}…</span>
                      : <span className="text-orange-400 flex-1">no hashed_id</span>
                    }
                    {m.discord_id && <span className="text-blue-400 shrink-0 text-[10px]">discord✓</span>}
                    {m.alts_found > 0 && (
                      <span className={`shrink-0 text-[10px] ${m.alts_matched > 0 ? 'text-blue-400' : 'text-muted-foreground'}`}>
                        {m.alts_matched}/{m.alts_found} alts
                      </span>
                    )}
                  </div>
                ))}
                {filteredMembers.length === 0 && (
                  <p className="text-xs text-muted-foreground py-2 text-center">No members match this filter</p>
                )}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AdminPageContent() {
  const api = useApiClient();
  const { isSuperAdmin } = useAuth();
  const [guilds, setGuilds] = useState<Guild[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [expandedGuild, setExpandedGuild] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState<string | null>(null);

  // Add user form state
  const [addingToGuild, setAddingToGuild] = useState<string | null>(null);
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserRole, setNewUserRole] = useState<'MEMBER' | 'OFFICER' | 'DEPUTY' | 'LEADER'>('MEMBER');
  const [submitting, setSubmitting] = useState(false);

  const fetchGuilds = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/admin/all-guilds');
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to fetch guilds');
      }
      const data = await res.json();
      setGuilds(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load guilds');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    fetchGuilds();
  }, [fetchGuilds]);

  const handleAddUser = async (guildId: string) => {
    if (!newUserEmail) {
      setError('Please enter an email address');
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await api.post('/api/admin/guild-users', {
        email: newUserEmail,
        role: newUserRole,
        target_guild_id: guildId,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add user');

      setSuccess(`Successfully added ${newUserEmail} to guild`);
      setNewUserEmail('');
      setNewUserRole('MEMBER');
      setAddingToGuild(null);
      await fetchGuilds();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add user');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateRole = async (guildId: string, userId: string, newRole: 'MEMBER' | 'OFFICER' | 'DEPUTY' | 'LEADER') => {
    setError(null);
    setSuccess(null);
    try {
      const res = await api.patch('/api/admin/guild-users', {
        user_id: userId,
        role: newRole,
        target_guild_id: guildId,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update role');
      setSuccess('Role updated successfully');
      await fetchGuilds();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update role');
    }
  };

  const handleRemoveUser = async (guildId: string, userId: string, email: string) => {
    if (!confirm(`Remove ${email} from this guild?`)) return;
    setError(null);
    setSuccess(null);
    try {
      const res = await api.delete(`/api/admin/guild-users?user_id=${userId}&target_guild_id=${guildId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to remove user');
      setSuccess(`Removed ${email} from guild`);
      await fetchGuilds();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove user');
    }
  };

  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'LEADER': return <Crown className="h-4 w-4 text-yellow-500" />;
      case 'DEPUTY': return <Shield className="h-4 w-4 text-purple-500" />;
      case 'OFFICER': return <Shield className="h-4 w-4 text-blue-500" />;
      default: return <Users className="h-4 w-4 text-gray-500" />;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Leadership Management</h1>
        <p className="text-muted-foreground">Manage leadership and settings across all Dream guilds</p>
      </div>

      {isSuperAdmin && <SuperAdminPanel />}

      {error && (
        <div className="flex items-center gap-2 p-4 bg-destructive/10 text-destructive rounded-lg">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}

      {success && (
        <div className="flex items-center gap-2 p-4 bg-green-500/10 text-green-500 rounded-lg">
          <Check className="h-4 w-4" />
          {success}
        </div>
      )}

      <div className="grid gap-4">
        {guilds.map((guild) => (
          <Card key={guild.id}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setExpandedGuild(expandedGuild === guild.id ? null : guild.id)}
                  >
                    {expandedGuild === guild.id ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </Button>
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <span className="font-mono font-bold text-primary">{guild.nickname}</span>
                      <span>-</span>
                      <span>{guild.name}</span>
                      <span className="text-sm text-muted-foreground font-normal">(ID: {guild.id})</span>
                      {!(guild.is_active ?? true) && (
                        <Badge variant="outline" className="text-xs bg-orange-500/10 text-orange-500 border-orange-500/50">Inactive</Badge>
                      )}
                    </CardTitle>
                    <CardDescription>
                      {guild.member_count} member{guild.member_count !== 1 ? 's' : ''}
                    </CardDescription>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">Leader</p>
                    {guild.leader ? (
                      <p className="text-sm font-medium flex items-center gap-1 justify-end">
                        <Crown className="h-3 w-3 text-yellow-500" />
                        {guild.leader.display_name}
                      </p>
                    ) : (
                      <p className="text-sm text-muted-foreground italic">None</p>
                    )}
                  </div>

                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">Deputy</p>
                    {guild.deputy ? (
                      <p className="text-sm font-medium flex items-center gap-1 justify-end">
                        <Shield className="h-3 w-3 text-purple-500" />
                        {guild.deputy.display_name}
                      </p>
                    ) : (
                      <p className="text-sm text-muted-foreground italic">None</p>
                    )}
                  </div>

                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">Officers</p>
                    <p className="text-sm font-medium">{guild.officers.length}</p>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setShowSettings(showSettings === guild.id ? null : guild.id)}
                    >
                      <Settings className="h-4 w-4 mr-2" />
                      Settings
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setAddingToGuild(addingToGuild === guild.id ? null : guild.id)}
                    >
                      <UserPlus className="h-4 w-4 mr-2" />
                      Add User
                    </Button>
                  </div>
                </div>
              </div>

              {/* Add User Form */}
              {addingToGuild === guild.id && (
                <div className="mt-4 p-4 border rounded-lg bg-muted/50">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="md:col-span-2">
                      <Label htmlFor={`email-${guild.id}`}>Email Address</Label>
                      <Input
                        id={`email-${guild.id}`}
                        type="email"
                        placeholder="user@example.com"
                        value={newUserEmail}
                        onChange={(e) => setNewUserEmail(e.target.value)}
                        disabled={submitting}
                      />
                    </div>
                    <div>
                      <Label htmlFor={`role-${guild.id}`}>Role</Label>
                      <Select
                        value={newUserRole}
                        onValueChange={(value) => setNewUserRole(value as any)}
                        disabled={submitting}
                      >
                        <SelectTrigger id={`role-${guild.id}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="MEMBER">Member</SelectItem>
                          <SelectItem value="OFFICER">Officer</SelectItem>
                          <SelectItem value="DEPUTY">Deputy</SelectItem>
                          {isSuperAdmin && <SelectItem value="LEADER">Leader</SelectItem>}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-3">
                    <Button size="sm" onClick={() => handleAddUser(guild.id)} disabled={submitting}>
                      {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add'}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => { setAddingToGuild(null); setNewUserEmail(''); }}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              {/* Guild Settings */}
              {showSettings === guild.id && (
                <div className="mt-4 space-y-4">
                  <GuildSettingsSection guildId={guild.id} guildName={guild.name} currentMinLevel={guild.min_level} currentIsActive={guild.is_active ?? true} />
                  <DiscordMappingSection guildId={guild.id} />
                  <AltCharactersSection guildId={guild.id} />
                </div>
              )}
            </CardHeader>

            {/* Expanded Member List */}
            {expandedGuild === guild.id && (
              <CardContent>
                {guild.members.length === 0 ? (
                  <p className="text-muted-foreground text-sm">No members in this guild.</p>
                ) : (
                  <div className="space-y-2">
                    {guild.members.map((member) => (
                      <div
                        key={member.user_id}
                        className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50"
                      >
                        <div className="flex-1">
                          <p className="font-medium">{member.display_name}</p>
                        </div>

                        <div className="flex items-center gap-3">
                          <Select
                            value={member.role}
                            onValueChange={(value) => handleUpdateRole(guild.id, member.user_id, value as any)}
                          >
                            <SelectTrigger className="w-[140px]">
                              <div className="flex items-center gap-2">
                                {getRoleIcon(member.role)}
                                <SelectValue />
                              </div>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="MEMBER">
                                <div className="flex items-center gap-2"><Users className="h-4 w-4" />Member</div>
                              </SelectItem>
                              <SelectItem value="OFFICER">
                                <div className="flex items-center gap-2"><Shield className="h-4 w-4 text-blue-500" />Officer</div>
                              </SelectItem>
                              <SelectItem value="DEPUTY">
                                <div className="flex items-center gap-2"><Shield className="h-4 w-4 text-purple-500" />Deputy</div>
                              </SelectItem>
                              {isSuperAdmin && (
                                <SelectItem value="LEADER">
                                  <div className="flex items-center gap-2"><Crown className="h-4 w-4 text-yellow-500" />Leader</div>
                                </SelectItem>
                              )}
                            </SelectContent>
                          </Select>

                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemoveUser(guild.id, member.user_id, member.email)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            )}
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Role Permissions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-start gap-2">
            <Crown className="h-5 w-5 text-yellow-500 mt-0.5" />
            <div>
              <p className="font-medium">Leader</p>
              <p className="text-sm text-muted-foreground">Full access — manage settings, members, leadership, and all guild features</p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Shield className="h-5 w-5 text-purple-500 mt-0.5" />
            <div>
              <p className="font-medium">Deputy</p>
              <p className="text-sm text-muted-foreground">Can trigger activity fetches, manage challenges, configure settings, and view reports</p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Shield className="h-5 w-5 text-blue-500 mt-0.5" />
            <div>
              <p className="font-medium">Officer</p>
              <p className="text-sm text-muted-foreground">Can trigger activity fetches, manage challenges, and view reports</p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Users className="h-5 w-5 text-gray-500 mt-0.5" />
            <div>
              <p className="font-medium">Member</p>
              <p className="text-sm text-muted-foreground">Can view leaderboard, members, and reports</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function AdminPage() {
  return (
    <ProtectedRoute requiredRole="LEADER">
      <AdminPageContent />
    </ProtectedRoute>
  );
}
