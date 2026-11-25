'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Loader2, Shield, UserCheck, Castle, Users, AlertTriangle, Swords, MessageSquare, Server, FlaskConical, Check, AlertCircle, LayoutGrid, FileWarning, ScrollText, ListChecks, type LucideIcon } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import ProtectedRoute from '@/components/ProtectedRoute';
import { useAuth } from '@/contexts/AuthContext';
import { useApiClient } from '@/lib/api-client';
import ClaimsPanel from '@/components/admin/ClaimsPanel';
import GuildsPanel from '@/components/admin/GuildsPanel';
import AltsOverviewPanel from '@/components/admin/AltsOverviewPanel';
import WarningsPanel from '@/components/warnings/WarningsPanel';
import AssaultAdminPanel from '@/components/admin/AssaultAdminPanel';
import DiscordMappingPanel from '@/components/admin/DiscordMappingPanel';
import RaidRemindersPanel from '@/components/admin/RaidRemindersPanel';
import AdvertisingPanel from '@/components/admin/AdvertisingPanel';
import RecruitPanel from '@/components/admin/RecruitPanel';
import LiveMessagesPanel from '@/components/admin/LiveMessagesPanel';
import DataManagementPanel from '@/components/admin/DataManagementPanel';
import PriceCachePanel from '@/components/admin/PriceCachePanel';
import PetsPanel from '@/components/admin/PetsPanel';
import { AltSyncTools, DiscordSwitches } from '@/components/admin/SuperAdminTools';
import { RoleSyncPanel } from '@/components/admin/RoleSyncPanel';

type Role = 'MEMBER' | 'OFFICER' | 'DEPUTY' | 'LEADER';
const LEVEL: Record<Role, number> = { MEMBER: 0, OFFICER: 1, DEPUTY: 2, LEADER: 3 };

// Minimum access per tab. 'SUPER' = super admin only.
type Access = Role | 'SUPER';

interface SubTab { id: string; label: string; access: Access; render: () => React.ReactNode }
interface HubTab { id: string; label: string; icon: React.ComponentType<{ className?: string }>; access: Access; subs: SubTab[] }

function RefreshPotionMetaCard() {
  const api = useApiClient();
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function run() {
    setRunning(true);
    setMsg(null);
    try {
      const res = await api.post('/api/admin/potions/refresh-meta', {});
      const d = await res.json().catch(() => ({}));
      if (!res.ok) setMsg({ ok: false, text: d.error ?? `Failed (${res.status})` });
      else {
        const parts = Object.entries(d)
          .filter(([k, v]) => k !== 'success' && typeof v === 'number')
          .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`);
        const skipped = Array.isArray(d.skipped) ? d.skipped.length : 0;
        setMsg({ ok: true, text: `Done. ${parts.join(', ')}${skipped ? `, skipped: ${skipped}` : ''}` });
      }
    } catch {
      setMsg({ ok: false, text: 'Network error' });
    } finally {
      setRunning(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><FlaskConical className="h-4 w-4" /> Potion metadata</CardTitle>
        <CardDescription>Re-reads duration, bonuses, quality and images for combat and XP potions from the IdleMMO API. Takes about a minute.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <Button size="sm" variant="outline" onClick={run} disabled={running}>
          {running && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
          Refresh potion meta
        </Button>
        {msg && (
          <p className={`text-sm flex items-start gap-1.5 ${msg.ok ? 'text-green-600' : 'text-destructive'}`}>
            {msg.ok ? <Check className="h-3.5 w-3.5 mt-0.5 shrink-0" /> : <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />}
            {msg.text}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// Guild tool pages that live outside the hub; staff reach them from here (not from the top nav).
const GUILD_TOOLS: { href: string; label: string; desc: string; icon: LucideIcon }[] = [
  { href: '/network', label: 'Network dashboard', desc: "Today's numbers, all guilds", icon: LayoutGrid },
  { href: '/reports', label: 'Inactivity report', desc: 'Copy or send to Discord', icon: FileWarning },
  { href: '/members', label: 'Members roster', desc: 'Synced from IdleMMO', icon: Users },
  { href: '/activity', label: 'Daily log', desc: 'Raw donations and deposits', icon: ScrollText },
  { href: '/challenges', label: 'Challenges', desc: 'Challenge cost calculator', icon: ListChecks },
];

const TABS: HubTab[] = [
  {
    id: 'claims', label: 'Claims & Access', icon: UserCheck, access: 'OFFICER',
    subs: [{ id: 'claims', label: 'Claims', access: 'OFFICER', render: () => <ClaimsPanel /> }],
  },
  {
    id: 'guilds', label: 'Guilds', icon: Castle, access: 'LEADER',
    subs: [{ id: 'leadership', label: 'Guild settings', access: 'LEADER', render: () => <GuildsPanel /> }],
  },
  {
    id: 'members', label: 'Members & Alts', icon: Users, access: 'SUPER',
    subs: [
      { id: 'alts', label: 'Alts overview', access: 'SUPER', render: () => <AltsOverviewPanel /> },
      { id: 'tools', label: 'Alt detection tools', access: 'SUPER', render: () => <AltSyncTools /> },
    ],
  },
  {
    id: 'warnings', label: 'Warnings', icon: AlertTriangle, access: 'OFFICER',
    subs: [{ id: 'history', label: 'History', access: 'OFFICER', render: () => <WarningsPanel /> }],
  },
  {
    id: 'assault', label: 'Assault', icon: Swords, access: 'DEPUTY',
    subs: [
      { id: 'schedule', label: 'Schedule & pings', access: 'DEPUTY', render: () => <AssaultAdminPanel /> },
      { id: 'recruit', label: 'Recruiting', access: 'DEPUTY', render: () => <RecruitPanel /> },
      { id: 'potions', label: 'Potions', access: 'LEADER', render: () => <RefreshPotionMetaCard /> },
    ],
  },
  {
    id: 'discord', label: 'Discord', icon: MessageSquare, access: 'OFFICER',
    subs: [
      // Live messages first (bot-owned posts, incl. the bump tracker button); advertising last.
      { id: 'live', label: 'Live messages', access: 'SUPER', render: () => <LiveMessagesPanel /> },
      { id: 'roles', label: 'Role sync', access: 'SUPER', render: () => <RoleSyncPanel /> },
      { id: 'mapping', label: 'Member mapping', access: 'OFFICER', render: () => <DiscordMappingPanel /> },
      { id: 'raids', label: 'Raid reminders', access: 'SUPER', render: () => <RaidRemindersPanel /> },
      { id: 'switches', label: 'Switches', access: 'SUPER', render: () => <DiscordSwitches /> },
      { id: 'ads', label: 'Advertising', access: 'OFFICER', render: () => <AdvertisingPanel /> },
    ],
  },
  {
    id: 'system', label: 'System', icon: Server, access: 'SUPER',
    subs: [
      { id: 'data', label: 'Data management', access: 'SUPER', render: () => <DataManagementPanel /> },
      { id: 'prices', label: 'Price cache', access: 'SUPER', render: () => <PriceCachePanel /> },
      { id: 'pets', label: 'Pets', access: 'SUPER', render: () => <PetsPanel /> },
    ],
  },
];

function AdminHub() {
  const { guilds, isSuperAdmin } = useAuth();
  const router = useRouter();
  const params = useSearchParams();

  // Highest role across all guild memberships, so an officer of any guild sees the hub
  // even while a different guild is selected. Panels still scope data per guild.
  const maxLevel = guilds.reduce((m, g) => Math.max(m, LEVEL[g.role as Role] ?? 0), -1);
  const can = (a: Access) => isSuperAdmin || (a !== 'SUPER' && maxLevel >= LEVEL[a]);

  const tabs = TABS
    .map(t => ({ ...t, subs: t.subs.filter(s => can(s.access)) }))
    .filter(t => can(t.access) && t.subs.length > 0);

  if (tabs.length === 0) {
    return (
      <div className="max-w-xl mx-auto p-6 text-center space-y-2">
        <Shield className="h-8 w-8 mx-auto text-muted-foreground" />
        <h1 className="text-xl font-bold">Staff only</h1>
        <p className="text-sm text-muted-foreground">The admin hub is for guild officers and above.</p>
      </div>
    );
  }

  const tabId = tabs.some(t => t.id === params.get('tab')) ? params.get('tab')! : tabs[0].id;
  const tab = tabs.find(t => t.id === tabId)!;
  const subId = tab.subs.some(s => s.id === params.get('sub')) ? params.get('sub')! : tab.subs[0].id;

  const go = (t: string, s?: string) => {
    const q = new URLSearchParams({ tab: t });
    if (s) q.set('sub', s);
    router.replace(`/admin?${q.toString()}`, { scroll: false });
  };

  return (
    <div className="max-w-7xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Shield className="h-6 w-6 text-primary" /> Admin</h1>
        <p className="text-sm text-muted-foreground">Staff tools for the Dream guilds</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        {GUILD_TOOLS.map(t => (
          <Link
            key={t.href}
            href={t.href}
            className="card-surface group flex items-start gap-2.5 rounded-lg border bg-card p-3 transition-colors hover:border-crystal/40 hover:bg-crystal/5"
          >
            <t.icon className="h-4 w-4 mt-0.5 shrink-0 text-crystal" />
            <span className="min-w-0">
              <span className="block text-sm font-medium">{t.label}</span>
              <span className="block text-xs text-muted-foreground truncate">{t.desc}</span>
            </span>
          </Link>
        ))}
      </div>

      <Tabs value={tabId} onValueChange={t => go(t)}>
        <TabsList className="w-full">
          {tabs.map(t => (
            <TabsTrigger key={t.id} value={t.id} className="gap-1.5">
              <t.icon className="h-4 w-4" />
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {tabs.map(t => (
          <TabsContent key={t.id} value={t.id} className="mt-4">
            {t.subs.length === 1 ? (
              t.subs[0].render()
            ) : (
              <Tabs value={t.id === tabId ? subId : t.subs[0].id} onValueChange={s => go(t.id, s)}>
                <TabsList className="h-9">
                  {t.subs.map(s => (
                    <TabsTrigger key={s.id} value={s.id} className="text-xs">{s.label}</TabsTrigger>
                  ))}
                </TabsList>
                {t.subs.map(s => (
                  <TabsContent key={s.id} value={s.id} className="mt-4">{s.render()}</TabsContent>
                ))}
              </Tabs>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

export default function AdminPage() {
  return (
    <ProtectedRoute>
      <Suspense fallback={<div className="flex justify-center p-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>}>
        <AdminHub />
      </Suspense>
    </ProtectedRoute>
  );
}
