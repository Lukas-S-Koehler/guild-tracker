'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Check, AlertCircle, Search, Info, MessageSquare, HelpCircle, Link2, Crown, BarChart2 } from 'lucide-react';
import { useApiClient } from '@/lib/api-client';
import { useAuth } from '@/contexts/AuthContext';
import ProtectedRoute from '@/components/ProtectedRoute';

interface GuildMemberDiscord {
  id: string;
  ign: string;
  discord_id: string | null;
  discord_username: string | null;
}

interface LinkedMemberInfo {
  id: string;
  ign: string;
  current_guild_id: string | null;
  discord_id: string | null;
  discord_username: string | null;
}

interface AltInfo {
  member_id: string;
  alt_ign: string;
  alt_hashed_id: string | null;
  alt_member_id: string | null;
  alt_member?: LinkedMemberInfo | null;
  // present on reverse links (guild member is the alt, main is cross-guild)
  main_member?: LinkedMemberInfo | null;
}

interface GuildStat {
  guild_id: string;
  guild_name: string;
  total: number;
  mapped: number;
}

const OFFICER_ROLES = new Set(['OFFICER', 'DEPUTY', 'LEADER']);

interface AccessibleGuild {
  guild_id: string;
  guild_name: string;
  role: string;
}

function DiscordMappingContent() {
  const api = useApiClient();
  const { guilds, isSuperAdmin } = useAuth();

  const contextGuilds: AccessibleGuild[] = isSuperAdmin
    ? guilds
    : guilds.filter(g => OFFICER_ROLES.has(g.role));

  const [accessibleGuilds, setAccessibleGuilds] = useState<AccessibleGuild[]>(contextGuilds);
  const [selectedGuildId, setSelectedGuildId] = useState<string>('');

  const [members, setMembers] = useState<GuildMemberDiscord[]>([]);
  const [alts, setAlts] = useState<AltInfo[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [editing, setEditing] = useState<Record<string, { discord_id: string; discord_username: string }>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [conflictPending, setConflictPending] = useState<{
    memberId: string;
    discordId: string | null;
    discordUsername: string | null;
    conflicts: { ign: string; discord_id: string }[];
  } | null>(null);
  const [search, setSearch] = useState('');
  const [showInstructions, setShowInstructions] = useState(false);

  // Super admin: fetch all guilds from API (context only has their own memberships)
  useEffect(() => {
    if (!isSuperAdmin) {
      setAccessibleGuilds(contextGuilds);
      return;
    }
    fetch('/api/admin/all-guilds')
      .then(r => r.ok ? r.json() : [])
      .then((data: Array<{ id: string; name: string; nickname?: string }>) => {
        const mapped: AccessibleGuild[] = data.map(g => ({
          guild_id: g.id,
          guild_name: g.nickname || g.name,
          role: 'LEADER',
        }));
        setAccessibleGuilds(mapped);
        if (mapped.length > 0) setSelectedGuildId(prev => prev || mapped[0].guild_id);
      })
      .catch(() => setAccessibleGuilds(contextGuilds));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuperAdmin]);

  // Non-super-admin: sync from context guilds
  useEffect(() => {
    if (isSuperAdmin) return;
    setAccessibleGuilds(contextGuilds);
    if (contextGuilds.length > 0) setSelectedGuildId(prev => prev || contextGuilds[0].guild_id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuperAdmin, guilds.length]);

  // Aggregate + per-guild stats
  const [allStats, setAllStats] = useState<{ total: number; mapped: number } | null>(null);
  const [perGuildStats, setPerGuildStats] = useState<GuildStat[]>([]);
  const [loadingStats, setLoadingStats] = useState(false);
  const statsLoaded = useRef(false);

  useEffect(() => {
    statsLoaded.current = false;
    setAllStats(null);
    setPerGuildStats([]);
  }, [isSuperAdmin, accessibleGuilds.length]);

  useEffect(() => {
    if (statsLoaded.current) return;
    statsLoaded.current = true;
    setLoadingStats(true);

    if (isSuperAdmin) {
      // Super admin: fetch per accessible-guild via members/list
      if (accessibleGuilds.length === 0) { setLoadingStats(false); return; }
      Promise.all(
        accessibleGuilds.map(g =>
          api.get('/api/members/list', { guildId: g.guild_id })
            .then(r => r.ok ? r.json() : [])
            .catch(() => [] as GuildMemberDiscord[])
        )
      ).then(results => {
        let total = 0;
        let mapped = 0;
        const stats: GuildStat[] = accessibleGuilds.map((g, i) => {
          const list: GuildMemberDiscord[] = Array.isArray(results[i]) ? results[i] : [];
          const gMapped = list.filter(m => m.discord_id).length;
          total += list.length;
          mapped += gMapped;
          return { guild_id: g.guild_id, guild_name: g.guild_name, total: list.length, mapped: gMapped };
        });
        setAllStats({ total, mapped });
        setPerGuildStats(stats);
      }).finally(() => setLoadingStats(false));
    } else {
      // Officer+: fetch aggregate stats from guild-stats endpoint (all guilds, counts only)
      fetch('/api/discord/guild-stats')
        .then(r => r.ok ? r.json() : [])
        .then((data: GuildStat[]) => {
          const stats: GuildStat[] = Array.isArray(data) ? data : [];
          const total = stats.reduce((s, g) => s + g.total, 0);
          const mapped = stats.reduce((s, g) => s + g.mapped, 0);
          setAllStats({ total, mapped });
          setPerGuildStats(stats);
        })
        .catch(() => setLoadingStats(false))
        .finally(() => setLoadingStats(false));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuperAdmin, accessibleGuilds.length]);

  const patchMember = useCallback(async (memberId: string, guildId: string, discord_id: string | null, discord_username: string | null, force = false) => {
    const qs = force ? `member_id=${memberId}&force=true` : `member_id=${memberId}`;
    return api.patch(`/api/members/list?${qs}`, { discord_id, discord_username }, { guildId });
  }, [api]);

  const loadMembers = useCallback(async (guildId: string) => {
    if (!guildId) return;
    setLoadingMembers(true);
    setEditing({});
    try {
      const [membersRes, altsRes] = await Promise.all([
        api.get('/api/members/list', { guildId }),
        api.get('/api/members/alts', { guildId }),
      ]);

      let membersData: GuildMemberDiscord[] = [];
      let altsData: AltInfo[] = [];

      if (membersRes.ok) membersData = await membersRes.json();
      if (altsRes.ok) altsData = await altsRes.json();

      // Build maps to find which alts need propagation
      const memberMapLocal = new Map(membersData.map(m => [m.id, m]));
      const altToMainLocal = new Map<string, string>();
      const mainToLinkedAltsLocal = new Map<string, { alt_member_id: string; guild_id: string }[]>();
      for (const alt of altsData) {
        if (!alt.alt_member_id) continue;
        altToMainLocal.set(alt.alt_member_id, alt.member_id);
        const arr = mainToLinkedAltsLocal.get(alt.member_id) ?? [];
        arr.push({ alt_member_id: alt.alt_member_id, guild_id: alt.alt_member?.current_guild_id ?? guildId });
        mainToLinkedAltsLocal.set(alt.member_id, arr);
      }

      // Auto-propagate: alts with no discord_id whose main has one
      const toPropagate = membersData.filter(m => {
        const mainId = altToMainLocal.get(m.id);
        if (!mainId) return false;
        const main = memberMapLocal.get(mainId);
        return main?.discord_id && !m.discord_id;
      });

      if (toPropagate.length > 0) {
        // Update local state immediately (optimistic), then patch DB best-effort
        const propagated = new Map<string, { discord_id: string | null; discord_username: string | null }>();
        for (const alt of toPropagate) {
          const mainId = altToMainLocal.get(alt.id)!;
          const main = memberMapLocal.get(mainId)!;
          propagated.set(alt.id, { discord_id: main.discord_id, discord_username: main.discord_username });
        }
        membersData = membersData.map(m => propagated.has(m.id) ? { ...m, ...propagated.get(m.id) } : m);

        const patchResults = await Promise.allSettled(
          toPropagate.map(alt => {
            const vals = propagated.get(alt.id)!;
            return patchMember(alt.id, guildId, vals.discord_id, vals.discord_username);
          })
        );

        // Update aggregate stats for newly mapped alts
        const newlyMapped = patchResults.filter(r => r.status === 'fulfilled').length;
        if (newlyMapped > 0) {
          setAllStats(prev => prev ? { ...prev, mapped: prev.mapped + newlyMapped } : prev);
          setPerGuildStats(prev => prev.map(g =>
            g.guild_id === guildId ? { ...g, mapped: g.mapped + newlyMapped } : g
          ));
        }
      }

      setMembers(membersData);
      setAlts(altsData);
    } catch { /* ignore */ }
    finally { setLoadingMembers(false); }
  }, [api, patchMember]);

  useEffect(() => {
    if (selectedGuildId) loadMembers(selectedGuildId);
  }, [selectedGuildId, loadMembers]);


  // Build relationship maps from alts state (covers same-guild and cross-guild links)
  const altMemberIds = new Set<string>();
  const altToMainId = new Map<string, string>();
  // memberId → all linked member IDs (both same-guild alts and cross-guild main/alts)
  const memberToGroupIds = new Map<string, Set<string>>();
  // id → discord info for cross-guild members (not in local members array)
  const crossGuildInfo = new Map<string, LinkedMemberInfo>();

  const addGroupEdge = (a: string, b: string) => {
    if (!memberToGroupIds.has(a)) memberToGroupIds.set(a, new Set());
    if (!memberToGroupIds.has(b)) memberToGroupIds.set(b, new Set());
    memberToGroupIds.get(a)!.add(b);
    memberToGroupIds.get(b)!.add(a);
  };

  for (const link of alts) {
    if (!link.alt_member_id) continue;
    altMemberIds.add(link.alt_member_id);
    altToMainId.set(link.alt_member_id, link.member_id);
    addGroupEdge(link.member_id, link.alt_member_id);

    // Store cross-guild member discord info
    if (link.alt_member?.id) crossGuildInfo.set(link.alt_member.id, link.alt_member);
    if (link.main_member?.id) crossGuildInfo.set(link.main_member.id, link.main_member);
  }

  const memberMap = new Map(members.map(m => [m.id, m]));

  // Returns all member IDs in the same account group globally (same-guild + cross-guild)
  const getGroupMemberIds = (memberId: string): string[] => {
    const visited = new Set<string>();
    const queue = [memberId];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);
      for (const linked of Array.from(memberToGroupIds.get(id) ?? [])) {
        if (!visited.has(linked)) queue.push(linked);
      }
    }
    return Array.from(visited);
  };

  // Returns discord info for any member in the group (same-guild or cross-guild)
  const getDiscordInfo = (memberId: string): { discord_id: string | null; discord_username: string | null } => {
    const local = memberMap.get(memberId);
    if (local) return { discord_id: local.discord_id, discord_username: local.discord_username };
    const cross = crossGuildInfo.get(memberId);
    return { discord_id: cross?.discord_id ?? null, discord_username: cross?.discord_username ?? null };
  };

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

  const doSave = async (memberId: string, discordId: string | null, discordUsername: string | null, force: boolean) => {
    setSaving(memberId);
    try {
      const res = await patchMember(memberId, selectedGuildId, discordId, discordUsername, force);
      if (!res.ok) {
        const d = await res.json();
        setMessage({ type: 'error', text: d.error || 'Save failed' });
        return;
      }

      const wasMap = !!members.find(m => m.id === memberId)?.discord_id;
      const nowMap = !!discordId;

      // Update same-guild group members in local state (backend handles cross-guild)
      const allGroupIds = new Set(getGroupMemberIds(memberId));
      setMembers(prev => prev.map(m =>
        allGroupIds.has(m.id) ? { ...m, discord_id: discordId, discord_username: discordUsername } : m
      ));
      setEditing(prev => { const n = { ...prev }; delete n[memberId]; return n; });

      // Total linked = all group members minus self (including cross-guild)
      const totalLinked = allGroupIds.size - 1;
      setMessage({
        type: 'success',
        text: totalLinked > 0
          ? `Saved + synced to ${totalLinked} linked character${totalLinked > 1 ? 's' : ''}`
          : 'Saved',
      });
      setTimeout(() => setMessage(null), 3000);

      if (allStats && wasMap !== nowMap) {
        setAllStats(prev => prev ? { ...prev, mapped: prev.mapped + (nowMap ? 1 : -1) } : prev);
        setPerGuildStats(prev => prev.map(g =>
          g.guild_id === selectedGuildId ? { ...g, mapped: g.mapped + (nowMap ? 1 : -1) } : g
        ));
      }
    } catch { setMessage({ type: 'error', text: 'Network error' }); }
    finally { setSaving(null); }
  };

  const handleSave = async (memberId: string) => {
    const vals = editing[memberId];
    if (!vals || !selectedGuildId) return;

    const discordId = vals.discord_id || null;
    const discordUsername = vals.discord_username || null;

    // Check for conflicts across ALL group members (same-guild + cross-guild)
    const groupIds = getGroupMemberIds(memberId);
    const conflicts = groupIds
      .filter(id => id !== memberId)
      .map(id => {
        const info = getDiscordInfo(id);
        const ign = memberMap.get(id)?.ign ?? crossGuildInfo.get(id)?.ign ?? id;
        return info.discord_id && info.discord_id !== discordId
          ? { ign, discord_id: info.discord_id }
          : null;
      })
      .filter((c): c is { ign: string; discord_id: string } => c !== null);

    if (conflicts.length > 0) {
      setConflictPending({ memberId, discordId, discordUsername, conflicts });
      return;
    }

    await doSave(memberId, discordId, discordUsername, false);
  };

  const handleForceOverwrite = async () => {
    if (!conflictPending) return;
    const { memberId, discordId, discordUsername } = conflictPending;
    setConflictPending(null);
    await doSave(memberId, discordId, discordUsername, true);
  };

  const selectedGuild = accessibleGuilds.find(g => g.guild_id === selectedGuildId);
  const guildMapped = members.filter(m => m.discord_id).length;

  const filtered = members.filter(m =>
    !search ||
    m.ign.toLowerCase().includes(search.toLowerCase()) ||
    (m.discord_username ?? '').toLowerCase().includes(search.toLowerCase())
  );

  const accessibleGuildIds = new Set(accessibleGuilds.map(g => g.guild_id));

  if (accessibleGuilds.length === 0 && !isSuperAdmin) {
    return (
      <div className="max-w-4xl mx-auto text-center py-16 text-muted-foreground">
        No guilds with Officer+ access found.
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <MessageSquare className="h-6 w-6 text-[#5865F2]" />
            Discord Mapping
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Link each member&apos;s IGN to their Discord account. Alt characters inherit automatically.
          </p>
        </div>

        {accessibleGuilds.length > 1 && (
          <Select value={selectedGuildId} onValueChange={v => { setSelectedGuildId(v); setSearch(''); }}>
            <SelectTrigger className="w-52">
              <SelectValue placeholder="Select guild" />
            </SelectTrigger>
            <SelectContent>
              {accessibleGuilds.map(g => (
                <SelectItem key={g.guild_id} value={g.guild_id}>
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-primary text-xs font-bold">{g.guild_name}</span>
                    <Badge variant="outline" className="text-[10px] h-4 px-1">{g.role}</Badge>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* All guilds overview — visible to all officer+ */}
      <Card className={isSuperAdmin ? 'border-yellow-500/30 bg-yellow-500/5' : 'border-border bg-muted/20'}>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            {isSuperAdmin
              ? <Crown className="h-4 w-4 text-yellow-500" />
              : <BarChart2 className="h-4 w-4 text-muted-foreground" />
            }
            All Guilds Overview
          </CardTitle>
        </CardHeader>
        <CardContent className="pb-4 space-y-3">
          {loadingStats ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {/* Totals row */}
              <div className="grid grid-cols-4 gap-2 text-center">
                {[
                  { label: 'Guilds', value: perGuildStats.length, color: '' },
                  { label: 'Members', value: allStats?.total ?? 0, color: '' },
                  { label: 'Mapped', value: allStats?.mapped ?? 0, color: 'text-green-500' },
                  { label: 'Unmapped', value: (allStats?.total ?? 0) - (allStats?.mapped ?? 0), color: (allStats?.total ?? 0) - (allStats?.mapped ?? 0) > 0 ? 'text-orange-400' : 'text-green-500' },
                ].map(s => (
                  <div key={s.label} className="p-2 rounded border bg-background">
                    <div className={`text-lg font-bold ${s.color}`}>{s.value}</div>
                    <div className="text-xs text-muted-foreground">{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Per-guild breakdown */}
              <div className="space-y-1.5 max-h-56 overflow-y-auto">
                {perGuildStats
                  .slice()
                  .sort((a, b) => (a.mapped / Math.max(a.total, 1)) - (b.mapped / Math.max(b.total, 1)))
                  .map(g => {
                    const pct = g.total > 0 ? Math.round((g.mapped / g.total) * 100) : 0;
                    const canAccess = accessibleGuildIds.has(g.guild_id);
                    return canAccess ? (
                      <button
                        key={g.guild_id}
                        className="w-full flex items-center gap-2 text-xs py-1 px-2 rounded hover:bg-muted/50 transition-colors text-left"
                        onClick={() => { setSelectedGuildId(g.guild_id); setSearch(''); }}
                      >
                        <span className="font-medium w-32 truncate shrink-0">{g.guild_name}</span>
                        <span className="text-green-500 shrink-0 w-8 text-right">{g.mapped}</span>
                        <span className="text-muted-foreground shrink-0">/</span>
                        <span className="text-muted-foreground shrink-0 w-6">{g.total}</span>
                        <div className="flex-1 bg-muted rounded-full h-1.5 min-w-0">
                          <div
                            className={`h-1.5 rounded-full transition-all ${pct === 100 ? 'bg-green-500' : pct > 50 ? 'bg-blue-500' : 'bg-orange-400'}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-muted-foreground shrink-0 w-8 text-right">{pct}%</span>
                      </button>
                    ) : (
                      <div
                        key={g.guild_id}
                        className="w-full flex items-center gap-2 text-xs py-1 px-2 rounded text-left opacity-60 cursor-default"
                      >
                        <span className="font-medium w-32 truncate shrink-0">{g.guild_name}</span>
                        <span className="text-green-500 shrink-0 w-8 text-right">{g.mapped}</span>
                        <span className="text-muted-foreground shrink-0">/</span>
                        <span className="text-muted-foreground shrink-0 w-6">{g.total}</span>
                        <div className="flex-1 bg-muted rounded-full h-1.5 min-w-0">
                          <div
                            className={`h-1.5 rounded-full transition-all ${pct === 100 ? 'bg-green-500' : pct > 50 ? 'bg-blue-500' : 'bg-orange-400'}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-muted-foreground shrink-0 w-8 text-right">{pct}%</span>
                      </div>
                    );
                  })}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Aggregate stats */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            {loadingStats ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground mx-auto" />
            ) : (
              <div className="text-2xl font-bold">{allStats?.total ?? '—'}</div>
            )}
            <div className="text-xs text-muted-foreground mt-0.5">
              Total Members
              {perGuildStats.length > 1 && <span className="ml-1 opacity-60">({perGuildStats.length} guilds)</span>}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            {loadingStats ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground mx-auto" />
            ) : (
              <div className="text-2xl font-bold text-green-500">{allStats?.mapped ?? '—'}</div>
            )}
            <div className="text-xs text-muted-foreground mt-0.5">Mapped</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            {loadingStats ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground mx-auto" />
            ) : (
              <div className={`text-2xl font-bold ${allStats && allStats.total - allStats.mapped > 0 ? 'text-orange-400' : 'text-green-500'}`}>
                {allStats ? allStats.total - allStats.mapped : '—'}
              </div>
            )}
            <div className="text-xs text-muted-foreground mt-0.5">Unmapped</div>
          </CardContent>
        </Card>
      </div>

      {/* Instructions */}
      <Card className="border-blue-500/30 bg-blue-500/5">
        <CardHeader className="pb-2 pt-4 px-4">
          <button
            className="flex items-center justify-between w-full text-left"
            onClick={() => setShowInstructions(v => !v)}
          >
            <CardTitle className="text-sm flex items-center gap-2">
              <HelpCircle className="h-4 w-4 text-blue-400" />
              How to find a Discord User ID
            </CardTitle>
            <span className="text-xs text-muted-foreground">{showInstructions ? 'hide' : 'show'}</span>
          </button>
        </CardHeader>
        {showInstructions && (
          <CardContent className="px-4 pb-4 space-y-3 text-sm">
            <div className="space-y-2">
              <p className="font-medium text-muted-foreground">Step 1 — Enable Developer Mode in Discord</p>
              <ol className="list-decimal list-inside space-y-1 text-muted-foreground text-xs ml-2">
                <li>Open Discord → click the gear icon (User Settings) near your username</li>
                <li>Go to <span className="font-mono bg-muted px-1 rounded">App Settings → Advanced</span></li>
                <li>Toggle <span className="font-medium text-foreground">Developer Mode</span> on</li>
              </ol>
            </div>
            <div className="space-y-2">
              <p className="font-medium text-muted-foreground">Step 2 — Copy a user&apos;s ID</p>
              <ol className="list-decimal list-inside space-y-1 text-muted-foreground text-xs ml-2">
                <li>Right-click any user&apos;s name in Discord (in a server or DM)</li>
                <li>Click <span className="font-medium text-foreground">Copy User ID</span> at the bottom</li>
                <li>Paste the 17–19 digit number into the <span className="font-mono bg-muted px-1 rounded">Discord ID</span> field below</li>
              </ol>
            </div>
            <div className="p-3 rounded bg-muted/50 text-xs space-y-1.5">
              <p className="flex items-start gap-2">
                <Info className="h-3 w-3 mt-0.5 shrink-0 text-blue-400" />
                <span>Discord IDs are permanent unique numbers (e.g. <span className="font-mono">1511359743078174862</span>). They never change even if the user changes their username.</span>
              </p>
              <p className="flex items-start gap-2">
                <Link2 className="h-3 w-3 mt-0.5 shrink-0 text-blue-400" />
                <span>Alt characters inherit the Discord ID from their main automatically when you save. No need to fill them in separately.</span>
              </p>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Mapping Table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <CardTitle className="text-base">
                {selectedGuild?.guild_name ?? 'Guild'} — Member Mappings
              </CardTitle>
              <CardDescription>
                {loadingMembers ? 'Loading…' : `${guildMapped}/${members.length} members linked to Discord`}
              </CardDescription>
            </div>
            <div className="relative w-56">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search IGN or username..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-8 h-8 text-sm"
              />
            </div>
          </div>
          {message && (
            <div className={`flex items-center gap-2 mt-2 p-2 rounded text-sm ${message.type === 'success' ? 'bg-green-500/10 text-green-600' : 'bg-destructive/10 text-destructive'}`}>
              {message.type === 'success' ? <Check className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
              {message.text}
            </div>
          )}
          {conflictPending && (
            <div className="mt-2 p-3 rounded border border-orange-500/40 bg-orange-500/10 text-sm space-y-2">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-orange-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-orange-300">Discord conflict detected</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {conflictPending.conflicts.map(c => (
                      <span key={c.ign}><span className="font-medium text-foreground">{c.ign}</span> already has Discord ID <span className="font-mono">{c.discord_id}</span></span>
                    )).reduce((acc: React.ReactNode[], el, i) => i === 0 ? [el] : [...acc, ', ', el], [])}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" className="h-7 text-xs bg-orange-500 hover:bg-orange-600 text-white" onClick={handleForceOverwrite}>
                  Overwrite all with new ID
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setConflictPending(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </CardHeader>
        <CardContent className="px-4 pb-4">
          {loadingMembers ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-[1fr_1.5fr_1.5fr_auto] gap-2 px-2 pb-1 mb-1 border-b">
                <span className="text-xs font-medium text-muted-foreground">IGN</span>
                <span className="text-xs font-medium text-muted-foreground">Discord ID (snowflake)</span>
                <span className="text-xs font-medium text-muted-foreground">Username</span>
                <span className="text-xs font-medium text-muted-foreground w-20">Status</span>
              </div>

              <div className="space-y-0.5">
                {filtered.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-6">No members found</p>
                )}
                {filtered.map(m => {
                  const mainId = altToMainId.get(m.id);
                  const isAlt = !!mainId;
                  // main info: check same-guild first, then cross-guild
                  const mainMember = mainId ? (memberMap.get(mainId) ?? crossGuildInfo.get(mainId) ?? null) : null;
                  // total linked = all group members minus self
                  const linkedAltCount = getGroupMemberIds(m.id).length - 1;

                  const ed = editing[m.id];
                  const discordId = ed?.discord_id ?? m.discord_id ?? '';
                  const discordUser = ed?.discord_username ?? m.discord_username ?? '';
                  const hasEdit = !!ed;
                  const isMapped = !!discordId;
                  const isValidId = discordId === '' || /^\d{17,20}$/.test(discordId);

                  // Inherited: any group member whose discord_id matches another group member's
                  // Inherited: discord matches any other member in the same account group
                  const isInherited = !!m.discord_id && getGroupMemberIds(m.id)
                    .filter(id => id !== m.id)
                    .some(id => getDiscordInfo(id).discord_id === m.discord_id);

                  return (
                    <div
                      key={m.id}
                      className={`grid grid-cols-[1fr_1.5fr_1.5fr_auto] gap-2 items-start px-2 py-1.5 rounded transition-colors
                        ${isAlt ? 'ml-4 bg-muted/10 border-l-2 border-muted/40' : 'hover:bg-muted/30'}
                        ${hasEdit ? 'bg-muted/20' : ''}
                      `}
                    >
                      {/* IGN */}
                      <div className="flex items-center gap-1.5 min-w-0 pt-1">
                        {isAlt
                          ? <Link2 className="h-3 w-3 shrink-0 text-muted-foreground/60" />
                          : <span className={`h-2 w-2 rounded-full shrink-0 mt-0.5 ${isMapped ? 'bg-green-500' : 'bg-muted-foreground/30'}`} />
                        }
                        <div className="min-w-0">
                          <span className="text-sm font-medium truncate block">{m.ign}</span>
                          {isAlt && mainMember && (
                            <span className="text-[10px] text-muted-foreground">alt of {mainMember.ign}</span>
                          )}
                          {!isAlt && linkedAltCount > 0 && (
                            <span className="text-[10px] text-blue-400/80">{linkedAltCount} alt{linkedAltCount > 1 ? 's' : ''} linked</span>
                          )}
                        </div>
                      </div>

                      {/* Discord ID */}
                      <div>
                        <input
                          className={`w-full px-2 py-1 rounded border bg-background text-xs font-mono transition-colors
                            ${hasEdit ? 'border-primary/50 bg-primary/5' : 'border-border'}
                            ${!isValidId ? 'border-destructive/70 bg-destructive/5' : ''}
                            ${isInherited && !hasEdit ? 'text-muted-foreground/60' : ''}
                          `}
                          placeholder="e.g. 1511359743078174862"
                          value={discordId}
                          onChange={e => handleEdit(m.id, 'discord_id', e.target.value)}
                        />
                        {!isValidId && (
                          <p className="text-[10px] text-destructive mt-0.5 px-1">Must be 17–20 digits</p>
                        )}
                      </div>

                      {/* Username */}
                      <input
                        className={`w-full px-2 py-1 rounded border bg-background text-xs transition-colors
                          ${hasEdit ? 'border-primary/50 bg-primary/5' : 'border-border'}
                          ${isInherited && !hasEdit ? 'text-muted-foreground/60' : ''}
                        `}
                        placeholder="e.g. username"
                        value={discordUser}
                        onChange={e => handleEdit(m.id, 'discord_username', e.target.value)}
                      />

                      {/* Status */}
                      <div className="flex items-center gap-1 w-20 justify-end pt-0.5">
                        {hasEdit && isValidId && (
                          <Button size="sm" className="h-6 text-xs px-2" onClick={() => handleSave(m.id)} disabled={saving === m.id}>
                            {saving === m.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                          </Button>
                        )}
                        {hasEdit && (
                          <Button size="sm" variant="ghost" className="h-6 text-xs px-1 text-muted-foreground"
                            onClick={() => { const n = { ...editing }; delete n[m.id]; setEditing(n); }}>
                            ✕
                          </Button>
                        )}
                        {!hasEdit && isInherited && (
                          <Badge variant="outline" className="text-[10px] h-5 bg-blue-500/10 text-blue-400 border-blue-500/30">inherited</Badge>
                        )}
                        {!hasEdit && !isInherited && m.discord_id && (
                          <Badge variant="outline" className="text-[10px] h-5 bg-green-500/10 text-green-600 border-green-500/30">linked</Badge>
                        )}
                        {!hasEdit && !m.discord_id && (
                          <Badge variant="outline" className="text-[10px] h-5 text-muted-foreground">none</Badge>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function DiscordMappingPage() {
  return (
    <ProtectedRoute requiredRole="OFFICER">
      <DiscordMappingContent />
    </ProtectedRoute>
  );
}
