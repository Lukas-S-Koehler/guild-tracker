'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, UserPlus, Trash2, Shield, Crown, Users, AlertCircle, Check, RefreshCw } from 'lucide-react';
import { useApiClient } from '@/lib/api-client';
import { useAuth } from '@/contexts/AuthContext';
import { RAIDS, guildRaids } from '@/lib/raids';

/**
 * Admin → Guilds. Pick a guild, then: Settings (requirement & bank, raids & level, buildings,
 * API key), Site access (website users and their roles), Alts. Discord posts for a guild
 * (inactivity report, guild hall) live in Admin → Discord → Live messages; Discord ↔ member
 * links in Admin → Discord → Member mapping.
 */

interface GuildMember {
  user_id: string;
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
  is_assault: boolean;
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
  overflow_enabled: boolean;
  overflow_limit: number;
  /** Raid keys from src/lib/raids.ts. Empty = default (raid matching min level). */
  raids: string[];
}

interface Building {
  id: string;
  name: string;
}

function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3 rounded-lg border p-4 bg-muted/20">
      <div>
        <p className="text-sm font-semibold">{title}</p>
        {desc && <p className="text-xs text-muted-foreground">{desc}</p>}
      </div>
      {children}
    </div>
  );
}

function Check2({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <div>
      <label className="flex items-center gap-2 cursor-pointer text-sm">
        <input type="checkbox" className="rounded" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        {label}
      </label>
      {hint && <p className="text-xs text-muted-foreground mt-0.5 ml-6">{hint}</p>}
    </div>
  );
}

const numberInput = (v: string) => (v === '' ? 0 : parseInt(v) || 0);

function GuildSettingsSection({ guildId, guildName, currentMinLevel, currentIsActive, currentIsAssault, onSaved }: {
  guildId: string; guildName: string; currentMinLevel: number; currentIsActive: boolean; currentIsAssault: boolean; onSaved: () => void;
}) {
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
    overflow_enabled: true,
    overflow_limit: 10000,
    raids: [],
  });
  const [minLevel, setMinLevel] = useState<number>(currentMinLevel);
  const [isActive, setIsActive] = useState<boolean>(currentIsActive);
  const [isAssault, setIsAssault] = useState<boolean>(currentIsAssault);
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
            overflow_enabled: data.settings?.overflow_enabled ?? true,
            overflow_limit: data.settings?.overflow_limit ?? 10000,
            raids: Array.isArray(data.settings?.raids) ? data.settings.raids : [],
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
  const set = <K extends keyof GuildSettings>(k: K, v: GuildSettings[K]) => setSettings((prev) => ({ ...prev, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    try {
      const [configRes, metaRes] = await Promise.all([
        api.post('/api/config', {
          guild_name: guildName,
          guild_id: guildId,
          api_key: settings.api_key || 'placeholder',
          donation_requirement: settings.donation_requirement,
          // Merged server-side into the existing settings, so keys not sent here are kept.
          settings: {
            donation_requirement: settings.donation_requirement,
            active_buildings: settings.active_buildings,
            requirement_period: settings.requirement_period,
            weekly_donation_requirement: settings.weekly_donation_requirement,
            deposits_only: settings.deposits_only,
            overflow_enabled: settings.overflow_enabled,
            overflow_limit: settings.overflow_limit,
            raids: settings.raids,
          },
        }, { guildId }),
        api.patch('/api/admin/guild-meta', { guild_id: guildId, min_level: minLevel, is_active: isActive, is_assault: isAssault }, { guildId }),
      ]);
      if (!configRes.ok) throw new Error((await configRes.json()).error || 'Failed to save config');
      if (!metaRes.ok) throw new Error((await metaRes.json()).error || 'Failed to save guild meta');
      showMsg('success', 'Settings saved');
      onSaved();
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
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sync failed');
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
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Backfill failed');
      const r = data.results?.[0];
      showMsg('success', `Bank backfilled: ${r?.logsUpdated ?? 0} logs updated across ${r?.members ?? 0} members`);
    } catch (err) {
      showMsg('error', err instanceof Error ? err.message : 'Backfill failed');
    } finally {
      setBackfillingBank(false);
    }
  };

  const toggleBuilding = (id: string) =>
    set('active_buildings', settings.active_buildings.includes(id) ? settings.active_buildings.filter((b) => b !== id) : [...settings.active_buildings, id]);

  if (loading) {
    return <div className="py-4 flex justify-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>;
  }

  const weekly = settings.requirement_period === 'weekly';

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Requirement & bank" desc="What members must donate. Checked once a day at 11:48 UTC.">
          <div className="flex gap-4">
            {(['daily', 'weekly'] as const).map((p) => (
              <label key={p} className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input type="radio" name={`period-${guildId}`} checked={settings.requirement_period === p} onChange={() => set('requirement_period', p)} />
                {p === 'daily' ? 'Daily' : 'Weekly'}
              </label>
            ))}
          </div>
          <div className="flex flex-wrap gap-4">
            <div>
              <Label className="text-xs text-muted-foreground">Daily requirement (gold)</Label>
              <Input type="number" value={settings.donation_requirement} onChange={(e) => set('donation_requirement', numberInput(e.target.value))} className="mt-1 w-36" />
            </div>
            {weekly && (
              <div>
                <Label className="text-xs text-muted-foreground">Weekly requirement (gold)</Label>
                <Input type="number" value={settings.weekly_donation_requirement} onChange={(e) => set('weekly_donation_requirement', numberInput(e.target.value))} className="mt-1 w-36" />
              </div>
            )}
          </div>
          {weekly && <Check2 checked={settings.deposits_only} onChange={(v) => set('deposits_only', v)} label="Stockpile deposits only (no challenge donations)" />}
          <Check2
            checked={settings.overflow_enabled}
            onChange={(v) => set('overflow_enabled', v)}
            label="Overflow bank"
            hint="Gold above the requirement is banked and covers later shortfalls."
          />
          {settings.overflow_enabled && (
            <div className="flex flex-wrap items-end gap-3 ml-6">
              <div>
                <Label className="text-xs text-muted-foreground">Bank limit (gold)</Label>
                <Input type="number" min={0} value={settings.overflow_limit} onChange={(e) => set('overflow_limit', numberInput(e.target.value))} className="mt-1 w-36" />
              </div>
              <Button size="sm" variant="outline" onClick={handleBackfillBank} disabled={backfillingBank}>
                {backfillingBank && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                Backfill bank history
              </Button>
            </div>
          )}
        </Section>

        <Section title="Raids & level" desc="Shown on the guild directory, guild pages and the raid schedule.">
          <div>
            <Label className="text-xs text-muted-foreground">Min combat level (CL)</Label>
            <Input type="number" value={minLevel} onChange={(e) => setMinLevel(parseInt(e.target.value) || 0)} className="mt-1 w-36" />
          </div>
          <Check2 checked={isActive} onChange={setIsActive} label="Guild is active" hint="Inactive guilds are hidden from the directory and get no inactivity warnings or reports." />
          <Check2 checked={isAssault} onChange={setIsAssault} label="Assault guild" hint="Runs no raids; shows on the Assault pages." />
          {!isAssault && (
            <div>
              <Label className="text-xs text-muted-foreground">Raids this guild runs</Label>
              <div className="mt-1 grid sm:grid-cols-2 gap-x-4 gap-y-1">
                {RAIDS.map((r) => (
                  <label key={r.key} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      className="rounded"
                      checked={settings.raids.includes(r.key)}
                      onChange={(e) => set('raids', e.target.checked ? [...settings.raids, r.key] : settings.raids.filter((k) => k !== r.key))}
                    />
                    <span>CL {r.min_cl}</span>
                    <span className="text-xs text-muted-foreground">{r.name}</span>
                  </label>
                ))}
              </div>
              {settings.raids.length === 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  None ticked: defaults to {guildRaids(null, minLevel)[0] ? `the CL ${guildRaids(null, minLevel)[0].min_cl} raid` : 'nothing (no raid matches the min CL)'}.
                </p>
              )}
            </div>
          )}
        </Section>

        <Section title="Buildings" desc="Active buildings decide which deposits count and feed the guild hall post.">
          {buildings.length ? (
            <div className="grid grid-cols-2 gap-2">
              {buildings.map((b) => (
                <label key={b.id} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" className="rounded" checked={settings.active_buildings.includes(b.id)} onChange={() => toggleBuilding(b.id)} />
                  {b.name}
                </label>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No buildings defined.</p>
          )}
        </Section>

        {isLeaderOfThisGuild && (
          <Section title="IdleMMO API key" desc="Used for the daily activity fetch, member sync and the guild hall post. Leader only.">
            <Input type="password" value={settings.api_key} onChange={(e) => set('api_key', e.target.value)} placeholder="Enter API key..." />
            <Button size="sm" variant="outline" onClick={handleSyncMembers} disabled={syncing}>
              {syncing ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
              Sync members now
            </Button>
          </Section>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={handleSave} disabled={saving}>
          {saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
          Save settings
        </Button>
        {message && (
          <span className={`text-sm flex items-center gap-1.5 ${message.type === 'success' ? 'text-green-500' : 'text-destructive'}`}>
            {message.type === 'success' ? <Check className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
            {message.text}
          </span>
        )}
        <span className="text-xs text-muted-foreground">Inactivity report and guild hall channels: Admin → Discord → Live messages.</span>
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


interface AltInfo {
  id: string;
  member_id: string;
  alt_ign: string;
  alt_hashed_id: string;
  alt_member_id: string | null;
  fetched_at: string;
  source?: 'sync' | 'manual';
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
  const [promoting, setPromoting] = useState<string | null>(null);

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

  const handleMakeMain = async (memberId: string, ign: string) => {
    if (!confirm(`Make ${ign} the main of its account? Rewrites alt rows as manual (locked).`)) return;
    setPromoting(memberId);
    try {
      const res = await api.post('/api/members/alts/set-main', { member_id: memberId }, { guildId });
      const data = await res.json();
      if (res.ok) {
        setMessage(`👑 ${ign} promoted — ${data.rows_written} rows rewritten (${data.account_size} chars)`);
        await load();
      } else {
        setMessage(data.error || 'Failed');
      }
    } catch { setMessage('Network error'); }
    finally { setPromoting(null); }
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
      <p className="text-xs text-muted-foreground">
        Alts auto-link via shared Discord ID + API sync. Click 👑 on an alt to make it the main of its account (locks rows as manual).
      </p>

      {membersWithAlts.length > 0 && (
        <div className="space-y-2 max-h-72 overflow-y-auto">
          {membersWithAlts.map(m => {
            const memberAlts = altsByMember.get(m.id) ?? [];
            return (
              <div key={m.id} className="text-xs flex items-start gap-2">
                <span className="font-medium w-24 shrink-0 truncate inline-flex items-center gap-1">
                  <Crown className="h-3 w-3 text-yellow-500 shrink-0" /> {m.ign}
                </span>
                <div className="flex flex-wrap gap-1 flex-1">
                  {memberAlts.map(a => {
                    const altMember = a.alt_member_id ? memberMap.get(a.alt_member_id) : null;
                    const isManual = a.source === 'manual';
                    return (
                      <span
                        key={a.id}
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs ${
                          isManual
                            ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
                            : altMember
                              ? 'bg-blue-500/20 text-blue-400'
                              : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {a.alt_ign}
                        {altMember ? ' ✓' : ''}
                        {isManual && <span className="opacity-70">·locked</span>}
                        {altMember && (
                          <button
                            onClick={() => handleMakeMain(altMember.id, a.alt_ign)}
                            disabled={promoting === altMember.id}
                            className="ml-0.5 text-yellow-500 hover:text-yellow-400"
                            title={`Make ${a.alt_ign} the main of this account`}
                          >
                            {promoting === altMember.id ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Crown className="h-2.5 w-2.5" />}
                          </button>
                        )}
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

export default function AdminPageContent() {
  const api = useApiClient();
  const { isSuperAdmin } = useAuth();
  const [guilds, setGuilds] = useState<Guild[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Add user form state
  const [addingToGuild, setAddingToGuild] = useState<string | null>(null);
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserRole, setNewUserRole] = useState<'MEMBER' | 'OFFICER' | 'DEPUTY' | 'LEADER'>('MEMBER');
  const [submitting, setSubmitting] = useState(false);
  const [userSuggestions, setUserSuggestions] = useState<string[]>([]);

  useEffect(() => {
    if (!addingToGuild) {
      setUserSuggestions([]);
      return;
    }
    const q = newUserEmail.trim();
    if (q.includes('@')) {
      setUserSuggestions([]);
      return;
    }
    const controller = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await api.get(`/api/admin/search-users?q=${encodeURIComponent(q)}`);
        if (!res.ok) return;
        const data = await res.json();
        setUserSuggestions(Array.isArray(data.usernames) ? data.usernames : []);
      } catch {
        // ignore
      }
    }, 150);
    return () => {
      controller.abort();
      clearTimeout(t);
    };
  }, [api, addingToGuild, newUserEmail]);

  const fetchGuilds = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/admin/all-guilds');
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to fetch guilds');
      }
      const data = await res.json();
      const list: Guild[] = Array.isArray(data) ? data : [];
      setGuilds(list);
      setSelectedId((cur) => cur ?? (list.find((g) => g.is_active ?? true) ?? list[0])?.id ?? null);
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
    const identifier = newUserEmail.trim();
    if (!identifier) {
      setError('Please enter an email address or username');
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccess(null);

    const isEmail = identifier.includes('@');

    try {
      const res = await api.post('/api/admin/guild-users', {
        ...(isEmail ? { email: identifier } : { username: identifier }),
        role: newUserRole,
        target_guild_id: guildId,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add user');

      setSuccess(`Successfully added ${identifier} to guild`);
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

  const handleRemoveUser = async (guildId: string, userId: string, name: string) => {
    if (!confirm(`Remove ${name} from this guild?`)) return;
    setError(null);
    setSuccess(null);
    try {
      const res = await api.delete(`/api/admin/guild-users?user_id=${userId}&target_guild_id=${guildId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to remove user');
      setSuccess(`Removed ${name} from guild`);
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

  const guild = guilds.find((g) => g.id === selectedId) ?? null;
  const active = guilds.filter((g) => g.is_active ?? true);
  const inactive = guilds.filter((g) => !(g.is_active ?? true));

  const chip = (g: Guild) => (
    <Button
      key={g.id}
      size="sm"
      variant={g.id === selectedId ? 'default' : 'outline'}
      className={!(g.is_active ?? true) && g.id !== selectedId ? 'opacity-60' : ''}
      onClick={() => { setSelectedId(g.id); setAddingToGuild(null); }}
      title={g.name}
    >
      <span className="font-mono">{g.nickname}</span>
    </Button>
  );

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {active.map(chip)}
          {inactive.length > 0 && <span className="text-xs text-muted-foreground ml-2">Inactive:</span>}
          {inactive.map(chip)}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-destructive/10 text-destructive rounded-lg text-sm">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 p-3 bg-green-500/10 text-green-500 rounded-lg text-sm">
          <Check className="h-4 w-4" />
          {success}
        </div>
      )}

      {guild && (
        <Card key={guild.id}>
          <CardHeader className="pb-3">
            <CardTitle className="flex flex-wrap items-center gap-2">
              {guild.name}
              <span className="font-mono text-crystal">{guild.nickname}</span>
              <span className="text-xs text-muted-foreground font-normal">ID {guild.id}</span>
              {!(guild.is_active ?? true) && <Badge variant="outline" className="text-orange-500 border-orange-500/50">Inactive</Badge>}
              {guild.is_assault && <Badge variant="outline">Assault</Badge>}
            </CardTitle>
            <CardDescription className="flex flex-wrap gap-x-4 gap-y-1">
              <span>CL {guild.min_level}+</span>
              <span className="inline-flex items-center gap-1"><Crown className="h-3 w-3 text-yellow-500" />{guild.leader?.display_name ?? 'no leader'}</span>
              {guild.deputy && <span className="inline-flex items-center gap-1"><Shield className="h-3 w-3 text-purple-500" />{guild.deputy.display_name}</span>}
              <span>{guild.member_count} site user{guild.member_count !== 1 ? 's' : ''}</span>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="settings">
              <TabsList>
                <TabsTrigger value="settings">Settings</TabsTrigger>
                <TabsTrigger value="access">Site access ({guild.members.length})</TabsTrigger>
                <TabsTrigger value="alts">Alts</TabsTrigger>
              </TabsList>

              <TabsContent value="settings" className="pt-3">
                <GuildSettingsSection
                  guildId={guild.id}
                  guildName={guild.name}
                  currentMinLevel={guild.min_level}
                  currentIsActive={guild.is_active ?? true}
                  currentIsAssault={guild.is_assault ?? false}
                  onSaved={fetchGuilds}
                />
              </TabsContent>

              <TabsContent value="access" className="pt-3 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <p className="text-xs text-muted-foreground max-w-xl">
                    Who can use this guild&apos;s staff tools on the website. <b>Leader</b>: everything incl. settings and API key ·
                    {' '}<b>Deputy</b>: settings, activity fetches, challenges, reports · <b>Officer</b>: activity fetches, challenges, reports ·
                    {' '}<b>Member</b>: member pages. Roles from claimed characters are added automatically.
                  </p>
                  <Button size="sm" variant="outline" onClick={() => setAddingToGuild(addingToGuild === guild.id ? null : guild.id)}>
                    <UserPlus className="h-4 w-4 mr-2" />
                    Add user
                  </Button>
                </div>

                {addingToGuild === guild.id && (
                  <div className="p-4 border rounded-lg bg-muted/40">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="md:col-span-2">
                        <Label htmlFor={`email-${guild.id}`}>Email or username</Label>
                        <Input
                          id={`email-${guild.id}`}
                          type="text"
                          placeholder="user@example.com or username"
                          value={newUserEmail}
                          onChange={(e) => setNewUserEmail(e.target.value)}
                          disabled={submitting}
                          list={`user-suggestions-${guild.id}`}
                          autoComplete="off"
                        />
                        <datalist id={`user-suggestions-${guild.id}`}>
                          {userSuggestions.map((name) => <option key={name} value={name} />)}
                        </datalist>
                      </div>
                      <div>
                        <Label htmlFor={`role-${guild.id}`}>Role</Label>
                        <Select value={newUserRole} onValueChange={(value) => setNewUserRole(value as typeof newUserRole)} disabled={submitting}>
                          <SelectTrigger id={`role-${guild.id}`}><SelectValue /></SelectTrigger>
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
                      <Button size="sm" variant="ghost" onClick={() => { setAddingToGuild(null); setNewUserEmail(''); }}>Cancel</Button>
                    </div>
                  </div>
                )}

                {guild.members.length === 0 ? (
                  <p className="text-muted-foreground text-sm">No website users in this guild.</p>
                ) : (
                  <div className="divide-y rounded-lg border">
                    {guild.members.map((member) => {
                      // Hierarchy: leaders manage deputies and below; leaders and the super admin only by the super admin.
                      // The API enforces it too (it also knows who the super admin is).
                      const locked = !isSuperAdmin && member.role === 'LEADER';
                      return (
                      <div key={member.user_id} className="flex items-center justify-between gap-3 px-3 py-2">
                        <p className="font-medium text-sm truncate">{member.display_name}</p>
                        {locked ? (
                          <span className="flex items-center gap-2 text-sm text-muted-foreground">{getRoleIcon(member.role)} Leader</span>
                        ) : (
                        <div className="flex items-center gap-2">
                          <Select value={member.role} onValueChange={(value) => handleUpdateRole(guild.id, member.user_id, value as GuildMember['role'])}>
                            <SelectTrigger className="w-[140px] h-8">
                              <div className="flex items-center gap-2">
                                {getRoleIcon(member.role)}
                                <SelectValue />
                              </div>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="MEMBER">Member</SelectItem>
                              <SelectItem value="OFFICER">Officer</SelectItem>
                              <SelectItem value="DEPUTY">Deputy</SelectItem>
                              {isSuperAdmin && <SelectItem value="LEADER">Leader</SelectItem>}
                            </SelectContent>
                          </Select>
                          <Button variant="ghost" size="sm" onClick={() => handleRemoveUser(guild.id, member.user_id, member.display_name)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                        )}
                      </div>
                      );
                    })}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="alts" className="pt-3">
                <AltCharactersSection guildId={guild.id} />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
