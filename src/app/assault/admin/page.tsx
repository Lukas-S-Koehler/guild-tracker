'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ArrowLeft, Loader2, AlertCircle, Check } from 'lucide-react';
import ProtectedRoute from '@/components/ProtectedRoute';
import { useAuth } from '@/contexts/AuthContext';
import { ApiClient } from '@/lib/api-client';
import GuildStatusCard, { type StatusValue } from '@/components/assault/GuildStatusCard';
import ZoneEditor, { type ZoneValue } from '@/components/assault/ZoneEditor';
import PingTimeline, { type PingStep } from '@/components/assault/PingTimeline';
import ChannelRoleMapping, { type MappingValue } from '@/components/assault/ChannelRoleMapping';

interface AssaultConfig {
  id: string;
  guild_id: string;
  active: boolean;
  launch_time_utc: string;
  zone_name: string;
  level_range: string;
  shrine_info: string;
  target_mob_count: string;
  enemy_priority: { name: string; level: number; gold_per_hr: number }[];
  discord_guild_id: string | null;
  announcement_channel_id: string | null;
  member_role_id: string | null;
  staff_role_id: string | null;
  skip_date: string | null;
  paused_until: string | null;
}

function GuildPanel({ guildId, guildName, onMsg }: {
  guildId: string;
  guildName: string;
  onMsg: (type: 'success' | 'error', text: string) => void;
}) {
  const [config, setConfig] = useState<AssaultConfig | null>(null);
  const [steps, setSteps] = useState<PingStep[]>([]);
  const [loading, setLoading] = useState(true);

  const api = (() => {
    const c = new ApiClient();
    c.setGuildId(guildId);
    return c;
  })();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cRes, sRes] = await Promise.all([
        api.get('/api/assault/config'),
        api.get('/api/assault/steps'),
      ]);
      const cJson = await cRes.json();
      const sJson = await sRes.json();
      if (!cRes.ok) throw new Error(cJson.error);
      if (!sRes.ok) throw new Error(sJson.error);
      setConfig(cJson.config);
      setSteps(sJson.steps);
    } catch (e) {
      onMsg('error', String(e));
    } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guildId]);

  useEffect(() => { load(); }, [load]);

  const patchConfig = async (patch: Partial<AssaultConfig>) => {
    const res = await api.patch('/api/assault/config', patch);
    const j = await res.json();
    if (!res.ok) { onMsg('error', j.error); return; }
    setConfig(j.config);
    onMsg('success', 'Saved');
  };

  const createStep = async (s: Omit<PingStep, 'id' | 'sort_order'>) => {
    const res = await api.post('/api/assault/steps', { ...s, sort_order: (steps[steps.length - 1]?.sort_order ?? 0) + 10 });
    const j = await res.json();
    if (!res.ok) return onMsg('error', j.error);
    setSteps(prev => [...prev, j.step]);
    onMsg('success', 'Step created');
  };

  const updateStep = async (id: string, patch: Partial<PingStep>) => {
    const res = await api.patch(`/api/assault/steps/${id}`, patch);
    const j = await res.json();
    if (!res.ok) return onMsg('error', j.error);
    setSteps(prev => prev.map(s => s.id === id ? j.step : s));
  };

  const deleteStep = async (id: string) => {
    if (!confirm('Delete this step?')) return;
    const res = await api.delete(`/api/assault/steps/${id}`);
    if (!res.ok) { const j = await res.json(); return onMsg('error', j.error); }
    setSteps(prev => prev.filter(s => s.id !== id));
    onMsg('success', 'Deleted');
  };

  const reorderSteps = async (ids: string[]) => {
    const res = await api.post('/api/assault/steps/reorder', { order: ids });
    if (!res.ok) { const j = await res.json(); return onMsg('error', j.error); }
    setSteps(prev => {
      const byId = new Map(prev.map(s => [s.id, s]));
      return ids.map((id, i) => ({ ...(byId.get(id)!), sort_order: (i + 1) * 10 }));
    });
  };

  const testPing = async (id: string) => {
    const res = await api.post('/api/assault/test-ping', { step_id: id });
    const j = await res.json();
    if (!res.ok) return onMsg('error', j.error);
    onMsg('success', 'Test ping sent');
  };

  const preview = async (id: string): Promise<string> => {
    const res = await api.post('/api/assault/preview', { step_id: id });
    const j = await res.json();
    if (!res.ok) { onMsg('error', j.error); return ''; }
    return j.rendered;
  };

  if (loading) return <div className="flex items-center justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (!config) return <p className="text-sm text-muted-foreground p-4">No assault config for this guild. Run the seed SQL first.</p>;

  const status: StatusValue = {
    active: config.active,
    launch_time_utc: config.launch_time_utc,
    skip_date: config.skip_date,
    paused_until: config.paused_until,
  };
  const zone: ZoneValue = {
    zone_name: config.zone_name,
    level_range: config.level_range,
    shrine_info: config.shrine_info,
    target_mob_count: config.target_mob_count,
    enemy_priority: config.enemy_priority ?? [],
  };
  const mapping: MappingValue = {
    discord_guild_id: config.discord_guild_id,
    announcement_channel_id: config.announcement_channel_id,
    member_role_id: config.member_role_id,
    staff_role_id: config.staff_role_id,
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>{guildName}</CardTitle><CardDescription>Guild ID: <code>{guildId}</code></CardDescription></CardHeader>
        <CardContent><GuildStatusCard value={status} onSave={patchConfig} /></CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Zone & Enemy Loadout</CardTitle></CardHeader>
        <CardContent><ZoneEditor value={zone} onSave={patchConfig} /></CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Ping Timeline</CardTitle><CardDescription>Offsets relative to launch time</CardDescription></CardHeader>
        <CardContent>
          <PingTimeline
            steps={steps}
            onCreate={createStep}
            onUpdate={updateStep}
            onDelete={deleteStep}
            onReorder={reorderSteps}
            onTest={testPing}
            onPreview={preview}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Discord Channel & Role Mapping</CardTitle></CardHeader>
        <CardContent><ChannelRoleMapping value={mapping} onSave={patchConfig} /></CardContent>
      </Card>
    </div>
  );
}

function AssaultManagerContent() {
  const { guilds, currentGuild } = useAuth();
  const visibleGuilds = guilds.filter(g => g.is_assault === true);
  const [activeGuildId, setActiveGuildId] = useState<string>(
    (currentGuild?.is_assault ? currentGuild.guild_id : visibleGuilds[0]?.guild_id) ?? ''
  );
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const showMsg = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 4000);
  };

  useEffect(() => {
    if (visibleGuilds.length > 0 && !visibleGuilds.some(g => g.guild_id === activeGuildId)) {
      setActiveGuildId(visibleGuilds[0].guild_id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guilds]);

  if (guilds.length === 0) {
    return <p className="p-6 text-muted-foreground">No guild memberships found.</p>;
  }

  if (visibleGuilds.length === 0) {
    return <p className="p-6 text-muted-foreground">No assault guilds.</p>;
  }

  return (
    <div className="container mx-auto p-4 max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link href="/assault"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" />Assault</Button></Link>
          <h1 className="text-2xl font-bold">Assault Admin</h1>
        </div>
      </div>

      {message && (
        <div className={`p-2 rounded text-sm flex items-center gap-2 ${message.type === 'success' ? 'bg-green-500/10 text-green-700' : 'bg-red-500/10 text-red-700'}`}>
          {message.type === 'success' ? <Check className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          {message.text}
        </div>
      )}

      <Tabs value={activeGuildId} onValueChange={setActiveGuildId}>
        <TabsList>
          {visibleGuilds.map(g => (
            <TabsTrigger key={g.guild_id} value={g.guild_id}>{g.guild_name}</TabsTrigger>
          ))}
        </TabsList>
        {visibleGuilds.map(g => (
          <TabsContent key={g.guild_id} value={g.guild_id}>
            <GuildPanel guildId={g.guild_id} guildName={g.guild_name} onMsg={showMsg} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

export default function AssaultManagerPage() {
  return (
    <ProtectedRoute requiredRole="DEPUTY">
      <AssaultManagerContent />
    </ProtectedRoute>
  );
}
