'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, AlertTriangle } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ApiClient, useApiClient } from '@/lib/api-client';
import { useAuth } from '@/contexts/AuthContext';
import ProtectedRoute from '@/components/ProtectedRoute';
import { formatGold } from '@/lib/utils';
import type { OverviewResponse, OverviewMember, OverviewAlt } from '@/app/api/overview/route';

function getWarningBadge(level: string | null): string {
  switch (level) {
    case 'warn1': return '⚠️';
    case 'warn2': return '⚠️⚠️';
    case 'kick': return '🚫';
    default: return '';
  }
}

function getWarningColor(level: string): string {
  switch (level) {
    case 'safe': return 'text-green-500';
    case 'warn1': return 'text-yellow-500';
    case 'warn2': return 'text-orange-500';
    case 'kick': return 'text-red-500';
    default: return 'text-muted-foreground';
  }
}

function getCellBg(status: 'green' | 'yellow' | 'red', altCovered?: boolean): string {
  if (altCovered) return 'bg-blue-500/20 border border-blue-500/40';
  switch (status) {
    case 'green': return 'bg-green-500/25 border border-green-500/40';
    case 'yellow': return 'bg-yellow-500/20 border border-yellow-500/40';
    case 'red': return 'bg-red-500/15 border border-red-400/30';
  }
}

function formatColHeader(colKey: string, period: 'daily' | 'weekly'): { top: string; bottom: string } {
  if (period === 'weekly') {
    const [, weekPart] = colKey.split('-W');
    // Compute Monday of this week
    const [yearStr, weekStr] = colKey.split('-W');
    const year = parseInt(yearStr);
    const week = parseInt(weekStr);
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const dow = jan4.getUTCDay() || 7;
    const mon1 = new Date(jan4);
    mon1.setUTCDate(jan4.getUTCDate() - dow + 1);
    const targetMon = new Date(mon1);
    targetMon.setUTCDate(mon1.getUTCDate() + (week - 1) * 7);
    const sun = new Date(targetMon);
    sun.setUTCDate(targetMon.getUTCDate() + 6);
    const monLabel = targetMon.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    return { top: `W${weekPart}`, bottom: monLabel };
  } else {
    const d = new Date(colKey + 'T00:00:00Z');
    const day = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
    const date = d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', timeZone: 'UTC' });
    return { top: day, bottom: date };
  }
}

interface DonationEntry {
  item_name: string;
  quantity: number;
  unit_price: number;
  gold_value: number;
}

interface CellDetailProps {
  colKey: string;
  period: NonNullable<OverviewResponse>['config']['period'];
  data: {
    gold_donated: number;
    deposits_gold: number;
    raids: number;
    met_requirement: boolean;
    cell_status: 'green' | 'yellow' | 'red';
    alt_covered?: boolean;
  };
  ign: string;
  memberId: string;
  guildId: string;
}

function CellDetail({ colKey, period, data, ign, memberId, guildId }: CellDetailProps) {
  const header = formatColHeader(colKey, period);
  const [donations, setDonations] = useState<DonationEntry[] | null>(null);
  const [loadingDonations, setLoadingDonations] = useState(false);

  useEffect(() => {
    if (period !== 'daily') return;
    setLoadingDonations(true);
    const client = new ApiClient();
    client.setGuildId(guildId);
    client.get(`/api/guild-activity?date=${colKey}`)
      .then(r => r.json())
      .then((logs: any[]) => {
        const log = logs.find((l: any) => l.members?.id === memberId);
        setDonations(log?.donations || []);
      })
      .catch(() => setDonations([]))
      .finally(() => setLoadingDonations(false));
  }, [colKey, memberId, guildId, period]);

  const regularDonations = donations?.filter(d => !d.item_name.startsWith('[DEPOSIT]')) ?? [];
  const deposits = donations?.filter(d => d.item_name.startsWith('[DEPOSIT]')) ?? [];

  return (
    <div className="space-y-2 min-w-[240px]">
      <p className="font-semibold text-sm">{ign} — {header.top} {header.bottom}</p>
      <div className="space-y-1 text-xs text-muted-foreground">
        <div className="flex justify-between gap-4">
          <span>Gold donated</span>
          <span className="font-medium text-foreground">{formatGold(data.gold_donated)}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span>Deposits</span>
          <span className="font-medium text-foreground">{formatGold(data.deposits_gold)}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span>Raids</span>
          <span className="font-medium text-foreground">{data.raids}</span>
        </div>
        <div className="flex justify-between gap-4 pt-1 border-t">
          <span>Requirement</span>
          <span className={data.met_requirement ? 'text-green-500 font-medium' : 'text-red-400 font-medium'}>
            {data.met_requirement ? '✓ Met' : '✗ Not met'}
          </span>
        </div>
        {data.alt_covered && (
          <div className="pt-1 text-blue-400">Covered by alt contribution</div>
        )}
      </div>
      {period === 'daily' && (
        loadingDonations ? (
          <div className="flex justify-center pt-1">
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          </div>
        ) : (regularDonations.length > 0 || deposits.length > 0) ? (
          <div className="pt-2 border-t space-y-2">
            {regularDonations.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-foreground">Challenge Donations</p>
                {regularDonations.map((d, i) => (
                  <div key={i} className="flex justify-between gap-4 text-xs text-muted-foreground">
                    <span>{d.item_name} ×{d.quantity}</span>
                    <span className="font-medium text-foreground">{formatGold(d.gold_value)}</span>
                  </div>
                ))}
              </div>
            )}
            {deposits.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-foreground">Guild Hall Deposits</p>
                {deposits.map((d, i) => (
                  <div key={i} className="flex justify-between gap-4 text-xs text-muted-foreground">
                    <span>{d.item_name.replace('[DEPOSIT] ', '')} ×{d.quantity}</span>
                    <span className="font-medium text-foreground">{formatGold(d.gold_value)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null
      )}
    </div>
  );
}

function MemberRow({
  member,
  columns,
  period,
  guildId,
}: {
  member: OverviewMember;
  columns: string[];
  period: 'daily' | 'weekly';
  guildId: string;
}) {
  const warnBadge = getWarningBadge(member.warning_level);
  const inactiveColor = getWarningColor(member.warning_level);

  return (
    <>
      <tr className="border-b hover:bg-muted/30 transition-colors">
        {/* Member name */}
        <td className="px-3 py-2 min-w-[140px] max-w-[180px]">
          <div className="flex items-center gap-1.5">
            {member.avatar_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={member.avatar_url} alt="" className="h-5 w-5 rounded-full shrink-0" />
            )}
            <span className="font-medium text-sm truncate">{member.ign}</span>
            {warnBadge && <span className="shrink-0 text-xs">{warnBadge}</span>}
          </div>
        </td>
        {/* Days inactive */}
        <td className={`px-3 py-2 text-center text-sm font-medium ${inactiveColor}`}>
          {member.days_inactive}d
        </td>
        {/* Period cells */}
        {columns.map((col) => {
          const p = member.periods[col];
          return (
            <td key={col} className="px-1 py-2 text-center">
              {p ? (
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      className={`w-12 h-8 rounded text-xs font-medium transition-opacity hover:opacity-80 cursor-pointer ${getCellBg(p.cell_status, p.alt_covered)}`}
                      title={p.alt_covered ? 'Alt covered' : undefined}
                    >
                      {p.alt_covered ? (
                        <span className="text-blue-400 text-[10px]">alt</span>
                      ) : p.cell_status === 'green' ? (
                        <span className="text-green-600">✓</span>
                      ) : p.gold_donated + p.deposits_gold > 0 ? (
                        <span className="text-yellow-600 text-[10px]">{formatGold(p.gold_donated + p.deposits_gold)}</span>
                      ) : null}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-3" side="top">
                    <CellDetail colKey={col} period={period} data={p} ign={member.ign} memberId={member.id} guildId={guildId} />
                  </PopoverContent>
                </Popover>
              ) : (
                <div className={`w-12 h-8 rounded mx-auto ${getCellBg('red')}`} />
              )}
            </td>
          );
        })}
      </tr>
      {/* Alt sub-rows */}
      {member.alts.map((alt) => (
        <AltRow key={alt.id} alt={alt} mainIgn={member.ign} columns={columns} period={period} guildId={guildId} />
      ))}
    </>
  );
}

function AltRow({
  alt,
  mainIgn,
  columns,
  period,
  guildId,
}: {
  alt: OverviewAlt;
  mainIgn: string;
  columns: string[];
  period: 'daily' | 'weekly';
  guildId: string;
}) {
  return (
    <tr className="border-b bg-muted/10 hover:bg-muted/20 transition-colors">
      <td className="px-3 py-1.5 min-w-[140px] max-w-[180px]">
        <div className="flex items-center gap-1.5 pl-5">
          <span className="text-muted-foreground text-xs">└</span>
          <div className="flex flex-col min-w-0">
            <span className="text-sm text-muted-foreground truncate">{alt.ign}</span>
            <span className="text-[10px] text-muted-foreground/60 truncate">alt of {mainIgn}</span>
          </div>
        </div>
      </td>
      <td className="px-3 py-1.5 text-center text-xs text-muted-foreground">—</td>
      {columns.map((col) => {
        const p = alt.periods[col];
        return (
          <td key={col} className="px-1 py-1.5 text-center">
            {p ? (
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    className={`w-12 h-7 rounded text-xs transition-opacity hover:opacity-80 cursor-pointer ${getCellBg(p.cell_status)}`}
                  >
                    {p.cell_status === 'green' ? (
                      <span className="text-green-600 text-[10px]">✓</span>
                    ) : p.gold_donated + p.deposits_gold > 0 ? (
                      <span className="text-yellow-600 text-[10px]">{formatGold(p.gold_donated + p.deposits_gold)}</span>
                    ) : null}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-3" side="top">
                  <CellDetail colKey={col} period={period} data={p} ign={alt.ign} memberId={alt.id} guildId={guildId} />
                </PopoverContent>
              </Popover>
            ) : (
              <div className={`w-12 h-7 rounded mx-auto ${getCellBg('red')}`} />
            )}
          </td>
        );
      })}
    </tr>
  );
}

interface GuildOption {
  id: string;
  name: string;
  nickname: string;
}

function OverviewPageContent() {
  const { guilds, currentGuild, isSuperAdmin, hasRole } = useAuth();
  const api = useApiClient();

  const [allGuilds, setAllGuilds] = useState<GuildOption[]>([]);
  const [selectedGuildId, setSelectedGuildId] = useState<string>('');
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoWarning, setAutoWarning] = useState(false);
  const [autoWarnResult, setAutoWarnResult] = useState<'ok' | 'err' | null>(null);

  // Load all guilds (super admin sees all; others see their own)
  useEffect(() => {
    if (isSuperAdmin) {
      api.get('/api/guilds/status').then(r => r.ok ? r.json() : []).then((data: GuildOption[]) => {
        if (!Array.isArray(data) || data.length === 0) return;
        setAllGuilds(data);
        if (!selectedGuildId) {
          const def = data.find((g: GuildOption) => g.id === currentGuild?.guild_id) || data[0];
          setSelectedGuildId(def.id);
        }
      });
    } else {
      const mapped: GuildOption[] = guilds.map(g => ({ id: g.guild_id, name: g.guild_name, nickname: g.guild_name }));
      setAllGuilds(mapped);
      if (!selectedGuildId && currentGuild?.guild_id) {
        setSelectedGuildId(currentGuild.guild_id);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuperAdmin, currentGuild?.guild_id]);

  const fetchData = useCallback(
    async (guildId: string) => {
      setLoading(true);
      try {
        const res = await api.get('/api/overview', { guildId });
        if (res.ok) {
          setData(await res.json());
        }
      } catch (err) {
        console.error('Overview fetch failed:', err);
      } finally {
        setLoading(false);
      }
    },
    [api]
  );

  useEffect(() => {
    if (selectedGuildId) {
      fetchData(selectedGuildId);
    }
  }, [selectedGuildId, fetchData]);

  const selectedMembership = guilds.find((g) => g.guild_id === selectedGuildId);
  const canManage = isSuperAdmin || (selectedMembership
    ? ['OFFICER', 'DEPUTY', 'LEADER'].includes(selectedMembership.role)
    : hasRole('OFFICER'));

  const handleForceWarn = async () => {
    const confirmed = window.confirm(
      'Force-Warn will immediately send warnings to all inactive members — the daily cron already does this automatically each night. Run it now anyway?'
    );
    if (!confirmed) return;
    setAutoWarning(true);
    setAutoWarnResult(null);
    try {
      const res = await api.post('/api/cron/auto-warn', {}, { guildId: selectedGuildId });
      setAutoWarnResult(res.ok ? 'ok' : 'err');
      if (res.ok) fetchData(selectedGuildId);
    } catch {
      setAutoWarnResult('err');
    } finally {
      setAutoWarning(false);
      setTimeout(() => setAutoWarnResult(null), 4000);
    }
  };

  const period = data?.config.period ?? 'daily';
  const columns = data?.columns ?? [];
  const members = data?.members ?? [];
  const summary = data?.summary ?? { safe: 0, warn1: 0, warn2: 0, kick: 0 };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">🗓️ Guild Overview</h1>
        <p className="text-muted-foreground">7-{period === 'weekly' ? 'week' : 'day'} activity overview for all members</p>
      </div>

      {/* Guild selector */}
      {allGuilds.length > 1 && (
        <div className="flex gap-2 flex-wrap">
          {allGuilds.map((g) => (
            <Button
              key={g.id}
              variant={selectedGuildId === g.id ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedGuildId(g.id)}
            >
              {g.nickname || g.name}
            </Button>
          ))}
        </div>
      )}

      {/* Summary + actions bar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex gap-2 flex-wrap">
          <Badge variant="outline" className="bg-green-500/20 text-green-500 border-green-500/50">
            Safe {summary.safe}
          </Badge>
          <Badge variant="outline" className="bg-yellow-500/20 text-yellow-500 border-yellow-500/50">
            ⚠️ Warn 1 — {summary.warn1}
          </Badge>
          <Badge variant="outline" className="bg-orange-500/20 text-orange-500 border-orange-500/50">
            ⚠️⚠️ Warn 2 — {summary.warn2}
          </Badge>
          <Badge variant="outline" className="bg-red-500/20 text-red-500 border-red-500/50">
            🚫 Kick — {summary.kick}
          </Badge>
        </div>

        {canManage && (
          <Button
            variant={autoWarnResult === 'ok' ? 'default' : autoWarnResult === 'err' ? 'destructive' : 'outline'}
            onClick={handleForceWarn}
            disabled={autoWarning || loading}
          >
            {autoWarning ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <AlertTriangle className="h-4 w-4 mr-1" />
            )}
            {autoWarning ? 'Warning…' : autoWarnResult === 'ok' ? 'Warned!' : autoWarnResult === 'err' ? 'Failed' : 'Force Warn'}
          </Button>
        )}
      </div>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle>
            Member Activity{data?.config.guild_name ? ` — ${data.config.guild_name}` : ''}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : members.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No members found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="px-3 py-2 text-left font-medium min-w-[140px]">Member</th>
                    <th className="px-3 py-2 text-center font-medium whitespace-nowrap">Inactive</th>
                    {columns.map((col) => {
                      const { top, bottom } = formatColHeader(col, period);
                      return (
                        <th key={col} className="px-1 py-2 text-center font-medium min-w-[56px]">
                          <div className="text-xs leading-tight">
                            <div>{top}</div>
                            <div className="text-muted-foreground font-normal">{bottom}</div>
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {members.filter((m) => !m.is_alt || !m.main_id).map((member) => (
                    <MemberRow key={member.id} member={member} columns={columns} period={period} guildId={selectedGuildId} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Legend */}
      <div className="text-sm text-muted-foreground p-4 bg-muted rounded-lg space-y-2">
        <p className="font-medium">Legend</p>
        <div className="flex gap-4 flex-wrap text-xs">
          <span className="flex items-center gap-1.5"><span className="w-4 h-4 rounded bg-green-500/25 border border-green-500/40 inline-block" /> Met requirement</span>
          <span className="flex items-center gap-1.5"><span className="w-4 h-4 rounded bg-yellow-500/20 border border-yellow-500/40 inline-block" /> Partial (below req)</span>
          <span className="flex items-center gap-1.5"><span className="w-4 h-4 rounded bg-red-500/15 border border-red-400/30 inline-block" /> No activity</span>
          <span className="flex items-center gap-1.5"><span className="w-4 h-4 rounded bg-blue-500/20 border border-blue-500/40 inline-block" /> Covered by alt (2× req)</span>
        </div>
        <p className="text-xs mt-1">
          Warning badges: ⚠️ = Warn 1 (2d inactive), ⚠️⚠️ = Warn 2 (3d), 🚫 = Kick (4d+) — from last 7 days of warnings.
        </p>
      </div>
    </div>
  );
}

export default function OverviewPage() {
  return (
    <ProtectedRoute requiredRole="MEMBER">
      <OverviewPageContent />
    </ProtectedRoute>
  );
}
