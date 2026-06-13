'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, AlertTriangle } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ApiClient, useApiClient } from '@/lib/api-client';
import { useAuth } from '@/contexts/AuthContext';
import ProtectedRoute from '@/components/ProtectedRoute';
import { formatGold } from '@/lib/utils';
import CronCountdown from '@/components/CronCountdown';
import type { OverviewResponse, OverviewMember } from '@/app/api/overview/route';

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

function getCellBg(status: 'green' | 'yellow' | 'red', sharedBankCovered?: boolean): string {
  if (sharedBankCovered) return 'bg-blue-500/20 border border-blue-500/40';
  switch (status) {
    case 'green': return 'bg-green-500/25 border border-green-500/40';
    case 'yellow': return 'bg-yellow-500/20 border border-yellow-500/40';
    case 'red': return 'bg-red-500/15 border border-red-400/30';
  }
}

function getWeekStartDate(weekKey: string): string {
  const [yearStr, weekStr] = weekKey.split('-W');
  const year = parseInt(yearStr);
  const week = parseInt(weekStr);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dayOfWeek = jan4.getUTCDay() || 7;
  const monday1 = new Date(jan4);
  monday1.setUTCDate(jan4.getUTCDate() - dayOfWeek + 1);
  const targetMonday = new Date(monday1);
  targetMonday.setUTCDate(monday1.getUTCDate() + (week - 1) * 7);
  return targetMonday.toISOString().split('T')[0];
}

function isBeforeJoin(col: string, firstSeen: string, period: 'daily' | 'weekly'): boolean {
  const colDate = period === 'weekly' ? getWeekStartDate(col) : col;
  return colDate < firstSeen;
}

function daysSinceDate(dateStr: string): number {
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.floor((todayUtc - new Date(dateStr).getTime()) / 86400000);
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
    shared_bank_covered?: boolean;
    shared_bank_amount?: number;
    bank_used?: number;
    bank_earned?: number;
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
        {(data.bank_used ?? 0) > 0 && (
          <div className="flex justify-between gap-4 text-red-400">
            <span>Bank used</span>
            <span className="font-medium">-{formatGold(data.bank_used!)}</span>
          </div>
        )}
        {(data.bank_earned ?? 0) > 0 && (
          <div className="flex justify-between gap-4 text-sky-400">
            <span>Bank earned</span>
            <span className="font-medium">+{formatGold(data.bank_earned!)}</span>
          </div>
        )}
        <div className="flex justify-between gap-4 pt-1 border-t">
          <span>Requirement</span>
          <span className={data.met_requirement ? 'text-green-500 font-medium' : 'text-red-400 font-medium'}>
            {data.met_requirement ? '✓ Met' : '✗ Not met'}
          </span>
        </div>
        {(data.shared_bank_amount ?? 0) > 0 && (
          <div className="flex justify-between gap-4 text-blue-400">
            <span>Shared bank</span>
            <span className="font-medium">🏦{formatGold(data.shared_bank_amount!)}</span>
          </div>
        )}
        {data.shared_bank_covered && (
          <div className="pt-1 text-blue-400">Covered by shared bank</div>
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

type GroupPosition = 'solo' | 'first' | 'middle' | 'last';

const GROUP_COLORS = [
  { border: 'border-l-2 border-purple-500/40 bg-purple-500/[0.04]', topBorder: 'border-t border-t-purple-500/20' },
  { border: 'border-l-2 border-cyan-500/40 bg-cyan-500/[0.04]', topBorder: 'border-t border-t-cyan-500/20' },
  { border: 'border-l-2 border-amber-500/40 bg-amber-500/[0.04]', topBorder: 'border-t border-t-amber-500/20' },
  { border: 'border-l-2 border-rose-500/40 bg-rose-500/[0.04]', topBorder: 'border-t border-t-rose-500/20' },
];

function groupAndSortMembers(members: OverviewMember[]): Array<{ member: OverviewMember; position: GroupPosition; groupColorIdx: number }> {
  const memberMap = new Map(members.map(m => [m.id, m]));
  const visited = new Set<string>();
  const groups: OverviewMember[][] = [];

  for (const member of members) {
    if (visited.has(member.id)) continue;
    visited.add(member.id);
    const group: OverviewMember[] = [member];
    for (const linked of member.linked_members) {
      const linkedMember = memberMap.get(linked.id);
      if (linkedMember && !visited.has(linked.id)) {
        group.push(linkedMember);
        visited.add(linked.id);
      }
    }
    groups.push(group);
  }

  groups.forEach(g => g.sort((a, b) => b.days_inactive - a.days_inactive));
  groups.sort((a, b) => {
    const maxA = Math.max(...a.map(m => m.days_inactive));
    const maxB = Math.max(...b.map(m => m.days_inactive));
    return maxB - maxA;
  });

  const result: Array<{ member: OverviewMember; position: GroupPosition; groupColorIdx: number }> = [];
  let colorIdx = 0;
  for (const group of groups) {
    if (group.length === 1) {
      result.push({ member: group[0], position: 'solo', groupColorIdx: -1 });
    } else {
      const idx = colorIdx++ % GROUP_COLORS.length;
      group.forEach((m, i) => {
        const position: GroupPosition = i === 0 ? 'first' : i === group.length - 1 ? 'last' : 'middle';
        result.push({ member: m, position, groupColorIdx: idx });
      });
    }
  }
  return result;
}

function MemberRow({
  member,
  columns,
  period,
  guildId,
  overflowEnabled,
  overflowLimit,
  groupPosition,
  groupColorIdx,
}: {
  member: OverviewMember;
  columns: string[];
  period: 'daily' | 'weekly';
  guildId: string;
  overflowEnabled: boolean;
  overflowLimit: number;
  groupPosition: GroupPosition;
  groupColorIdx: number;
}) {
  const warnBadge = getWarningBadge(member.warning_level);
  const inactiveColor = getWarningColor(member.warning_level);
  const isNew = member.first_seen ? daysSinceDate(member.first_seen) <= 7 : false;
  const isCapped = overflowEnabled && member.bank_balance >= overflowLimit && overflowLimit > 0;

  const isGrouped = groupPosition !== 'solo';
  const gc = isGrouped && groupColorIdx >= 0 ? GROUP_COLORS[groupColorIdx % GROUP_COLORS.length] : null;
  const groupRowClass = gc
    ? `${gc.border} ${groupPosition === 'first' ? gc.topBorder : ''}`
    : '';

  return (
    <>
      <tr className={`border-b hover:bg-muted/30 transition-colors ${groupRowClass}`}>
        {/* Member name */}
        <td className="px-3 py-2 min-w-[160px] max-w-[220px]">
          <div className="flex items-center gap-1.5">
            {member.avatar_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={member.avatar_url} alt="" className="h-5 w-5 rounded-full shrink-0" />
            )}
            <span className="font-medium text-sm truncate">{member.ign}</span>
            {isNew && (
              <span
                className="shrink-0 text-[10px] font-medium px-1 py-0.5 rounded bg-sky-500/20 text-sky-400 border border-sky-500/30"
                title={`Joined ${member.first_seen}`}
              >
                new
              </span>
            )}
            {warnBadge && <span className="shrink-0 text-xs">{warnBadge}</span>}
            {member.linked_members.length > 0 && (
              <span
                className="shrink-0 text-[10px] font-medium px-1 py-0.5 rounded bg-purple-500/20 text-purple-400 border border-purple-500/30"
                title={`Linked: ${member.linked_members.map(l => l.ign).join(', ')}`}
              >
                🔗
              </span>
            )}
          </div>
          {overflowEnabled && member.combined_bank_balance > 0 && (
            <div
              className="mt-0.5 text-[10px] text-amber-400/80 font-medium flex items-center gap-1"
              title={`Bank: ${member.bank_balance.toLocaleString()}g own${member.linked_members.length > 0 ? ` + ${(member.combined_bank_balance - member.bank_balance).toLocaleString()}g linked` : ''}`}
            >
              <span>🏦 {formatGold(member.combined_bank_balance)}{member.linked_members.length > 0 && member.combined_bank_balance !== member.bank_balance ? ' (combined)' : ''}</span>
              {isCapped && (
                <span className="px-0.5 py-px rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[9px] font-semibold">CAP</span>
              )}
            </div>
          )}
        </td>
        {/* Days inactive */}
        <td className={`px-3 py-2 text-center text-sm font-medium ${inactiveColor}`}>
          {member.days_inactive}d
        </td>
        {/* Period cells */}
        {columns.map((col) => {
          const p = member.periods[col];
          const beforeJoin = !p && member.first_seen ? isBeforeJoin(col, member.first_seen, period) : false;
          return (
            <td key={col} className="px-1 py-2 text-center">
              {p ? (
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      className={`w-12 h-8 rounded text-xs font-medium transition-opacity hover:opacity-80 cursor-pointer ${getCellBg(p.cell_status, p.shared_bank_covered)}`}
                      title={p.shared_bank_covered ? 'Covered by shared bank' : undefined}
                    >
                      {p.shared_bank_covered ? (
                        <div className="flex flex-col items-center leading-none gap-px">
                          <span className="text-blue-400 text-xs">✓</span>
                          {p.shared_bank_amount > 0 && (
                            <span className="text-blue-300 text-[9px] font-normal">🏦{formatGold(p.shared_bank_amount)}</span>
                          )}
                        </div>
                      ) : p.cell_status === 'green' ? (
                        <div className="flex flex-col items-center leading-none gap-px">
                          <span className="text-green-600 text-xs">✓</span>
                          {p.bank_earned > 0 && (
                            <span className="text-sky-400 text-[9px] font-normal">+{formatGold(p.bank_earned)}</span>
                          )}
                          {p.bank_used > 0 && (
                            <span className="text-red-400 text-[9px] font-normal">-{formatGold(p.bank_used)}</span>
                          )}
                        </div>
                      ) : (p.gold_donated + p.deposits_gold + p.bank_used) > 0 ? (
                        <div className="flex flex-col items-center leading-none gap-px">
                          <span className="text-yellow-600 text-[10px]">{formatGold(p.gold_donated + p.deposits_gold)}</span>
                          {p.bank_used > 0 && (
                            <span className="text-red-400 text-[9px] font-normal">-{formatGold(p.bank_used)}</span>
                          )}
                        </div>
                      ) : null}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-3" side="top">
                    <CellDetail colKey={col} period={period} data={p} ign={member.ign} memberId={member.id} guildId={guildId} />
                  </PopoverContent>
                </Popover>
              ) : beforeJoin ? (
                <div className="w-12 h-8 rounded mx-auto bg-muted/30 border border-muted-foreground/10" title="Not yet a member" />
              ) : (
                <div className={`w-12 h-8 rounded mx-auto ${getCellBg('red')}`} />
              )}
            </td>
          );
        })}
      </tr>
    </>
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
  const overflowEnabled = data?.config.overflow_enabled ?? true;
  const overflowLimit = data?.config.overflow_limit ?? 10000;
  const groupedMembers = useMemo(() => groupAndSortMembers(members), [members]);


  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-6">
        <div>
          <h1 className="text-2xl font-bold">🗓️ Guild Overview</h1>
          <div className="flex items-center gap-3">
            <p className="text-muted-foreground">
            7-{period === 'weekly' ? 'week' : 'day'} activity overview for all members
            {data && (
              <span className="ml-2 text-xs font-medium text-amber-400/80">
                {period === 'weekly'
                  ? `· Weekly req: ${data.config.weekly_donation_requirement.toLocaleString()}g · Daily req: ${data.config.donation_requirement.toLocaleString()}g`
                  : `· Daily req: ${data.config.donation_requirement.toLocaleString()}g`}
              </span>
            )}
          </p>
            <CronCountdown />
          </div>
        </div>
        {overflowEnabled && (
          <div className="text-right text-xs text-muted-foreground leading-snug shrink-0 pt-0.5">
            <p className="font-semibold text-amber-400/80">🏦 Bank cap: {formatGold(overflowLimit)}/member</p>
            <p>Excess above daily req is banked · drawn on missed days</p>
          </div>
        )}
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
                  {groupedMembers.map(({ member, position, groupColorIdx }) => (
                    <MemberRow key={member.id} member={member} columns={columns} period={period} guildId={selectedGuildId} overflowEnabled={overflowEnabled} overflowLimit={data?.config.overflow_limit ?? 10000} groupPosition={position} groupColorIdx={groupColorIdx} />
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
          <span className="flex items-center gap-1.5"><span className="w-4 h-4 rounded bg-blue-500/20 border border-blue-500/40 inline-block" /> Covered by shared bank (linked chars pool excess)</span>
          <span className="flex items-center gap-1.5"><span className="w-4 h-4 rounded bg-muted/30 border border-muted-foreground/10 inline-block" /> Not yet a member</span>
          <span className="flex items-center gap-1.5"><span className="text-sky-400 text-[10px] font-medium px-1 py-0.5 rounded bg-sky-500/20 border border-sky-500/30">new</span> Joined within 7 days</span>
        </div>
        <p className="text-xs mt-1">
          Warning badges: ⚠️ = Warn 1 (2d inactive), ⚠️⚠️ = Warn 2 (3d), 🚫 = Kick (4d+) — from last 7 days of warnings.
        </p>
        {overflowEnabled && (
          <p className="text-xs">
            🏦 = Gold bank · max {formatGold(data?.config.overflow_limit ?? 10000)}/member · linked accounts share a combined pool (N members × cap) · red -X = bank drawn · +X = bank earned · CAP = at limit
          </p>
        )}
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
