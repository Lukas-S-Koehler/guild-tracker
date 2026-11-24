'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useApiClient } from '@/lib/api-client';
import { profilePath } from '@/lib/profile-path';
import { formatGold, getRankEmoji } from '@/lib/utils';

export type NetworkBoardKey = 'pass' | 'discord' | 'streak' | 'best_streak' | 'improved' | 'dream_xp';

interface Row {
  key: string;
  ign: string;
  class: string | null;
  guild_nickname: string | null;
  alt_igns: string[];
  value: number;
  before?: number;
  after?: number;
  level?: number;
  stars?: number;
  messages?: number;
  rank_name?: string | null;
  rank_emoji?: string | null;
}

export interface NetworkBoardsData {
  day: string;
  windows: { before: [string, string]; after: [string, string] };
  boards: Record<NetworkBoardKey, Row[]>;
  classes: string[];
  pass_seasons?: string[];
}

const BOARDS: Record<NetworkBoardKey, { title: string; description: string; unit: string }> = {
  pass: {
    title: '🎟️ Dream Pass',
    description: 'Season XP this month (assaults weigh the most, then daily requirement, raids, contribution, community and chat). Resets on the 1st; the top 10 become Season Champions. Alts pooled.',
    unit: 'XP',
  },
  discord: {
    title: '💬 Discord level',
    description: 'DreamBot\'s own Discord levels: 1 XP per counted message in member channels (5+ characters, 60 s apart) and per bump. Staff and bot channels don\'t count. Alts and linked Discord accounts pooled.',
    unit: 'XP',
  },
  streak: {
    title: '🔥 Current streak',
    description: 'Days in a row the requirement was met. Any character of the account counts; holidays pause the streak instead of breaking it.',
    unit: 'Days',
  },
  best_streak: {
    title: '🏔️ Longest streak',
    description: 'Longest run of met days ever. Same rules as the current streak.',
    unit: 'Days',
  },
  improved: {
    title: '📈 Most improved',
    description: 'Activity score (raids × 1,000 + gold) of the last 7 checked days vs the 7 days before. Only accounts active in both weeks.',
    unit: 'Gain',
  },
  dream_xp: {
    title: '🌌 Dream XP',
    description: 'Lifetime Dream XP: every Dream Pass season added up. Sets the rank role (Dreamer 300 · Lucid 1.25k · Visionary 3k · Crystal Mind 6k · Dream Weaver 15k). Alts pooled.',
    unit: 'XP',
  },
};

export const prettyClass = (c: string) => c.charAt(0) + c.slice(1).toLowerCase();
const short = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** Places with ties sharing a rank. */
function places(rows: Row[]): number[] {
  const out: number[] = [];
  rows.forEach((r, i) => out.push(i > 0 && rows[i - 1]!.value === r.value ? out[i - 1]! : i + 1));
  return out;
}

export function useNetworkBoards() {
  const api = useApiClient();
  const [data, setData] = useState<NetworkBoardsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await api.get('/api/leaderboard/network');
        const json = await res.json();
        if (!live) return;
        if (!res.ok) setError(json.error ?? 'Failed to load');
        else setData(json);
      } catch {
        if (live) setError('Failed to load');
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { data, error };
}

const monthLabel = (s: string) => new Date(`${s}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

export function NetworkBoard({ board, data, error }: { board: NetworkBoardKey; data: NetworkBoardsData | null; error: string | null }) {
  const api = useApiClient();
  const meta = BOARDS[board];
  const seasons = data?.pass_seasons ?? [];
  const [season, setSeason] = useState<string | null>(null);
  const [past, setPast] = useState<{ season: string; rows: Row[] } | null>(null);
  const pastMonth = board === 'pass' && season && seasons[0] && season !== seasons[0] ? season : null;
  useEffect(() => {
    if (!pastMonth || past?.season === pastMonth) return;
    let live = true;
    api.get(`/api/leaderboard/pass?season=${pastMonth}`).then((r) => r.json()).then((j) => live && j.rows && setPast({ season: pastMonth, rows: j.rows })).catch(() => {});
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pastMonth]);
  const rows = pastMonth ? (past?.season === pastMonth ? past.rows : []) : data?.boards[board] ?? [];
  const ranks = places(rows);
  const description =
    board === 'improved' && data
      ? `${meta.description} ${short(data.windows.before[0])}–${short(data.windows.before[1])} → ${short(data.windows.after[0])}–${short(data.windows.after[1])}.`
      : meta.description;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle>{meta.title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          {board === 'pass' && seasons.length > 0 && (
            <select
              aria-label="Month"
              className="h-9 rounded-md border bg-background px-3 text-sm"
              value={season ?? seasons[0]}
              onChange={(e) => setSeason(e.target.value)}
            >
              {seasons.map((x, idx) => (
                <option key={x} value={x}>
                  {monthLabel(x)}{idx === 0 ? ' (this month)' : ''}
                </option>
              ))}
            </select>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="text-center text-muted-foreground py-8">{error}</p>
        ) : !data || (pastMonth && past?.season !== pastMonth) ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">Nobody on this board yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-muted-foreground text-sm border-b">
                  <th className="pb-3 w-16">Rank</th>
                  <th className="pb-3">Member</th>
                  <th className="pb-3">Guild</th>
                  {board === 'improved' && <th className="pb-3 text-right hidden sm:table-cell">Before → after</th>}
                  {(board === 'pass' || board === 'discord') && <th className="pb-3 text-right">Level</th>}
                  {board === 'discord' && <th className="pb-3 text-right hidden sm:table-cell">Messages</th>}
                  <th className="pb-3 text-right">{meta.unit}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.key} className={`border-b last:border-0 ${ranks[i]! <= 3 ? 'bg-muted/30' : ''}`}>
                    <td className="py-3">
                      <span className="text-lg">{getRankEmoji(ranks[i]!)}</span>
                    </td>
                    <td className="py-3">
                      <Link href={profilePath(r.ign)} className="font-medium hover:underline underline-offset-4">
                        {r.ign}
                      </Link>
                      {r.class && <span className="ml-1.5 text-xs text-muted-foreground">{prettyClass(r.class)}</span>}
                      {r.alt_igns.length > 0 && (
                        <span className="ml-1.5 text-xs text-blue-400" title={`Alts: ${r.alt_igns.join(', ')}`}>
                          +{r.alt_igns.length} alt{r.alt_igns.length > 1 ? 's' : ''}
                        </span>
                      )}
                      {board === 'dream_xp' && r.rank_name && (
                        <div className="text-xs text-muted-foreground">
                          {r.rank_emoji} {r.rank_name}
                        </div>
                      )}
                    </td>
                    <td className="py-3">
                      <span className="font-mono text-sm font-bold text-primary">{r.guild_nickname || '-'}</span>
                    </td>
                    {board === 'improved' && (
                      <td className="py-3 text-right font-mono text-sm text-muted-foreground hidden sm:table-cell">
                        {formatGold(r.before ?? 0)} → {formatGold(r.after ?? 0)}
                      </td>
                    )}
                    {(board === 'pass' || board === 'discord') && (
                      <td className="py-3 text-right font-mono text-sm">
                        {r.level}
                        {r.stars ? <span className="ml-1 text-amber-400">★{r.stars}</span> : null}
                      </td>
                    )}
                    {board === 'discord' && (
                      <td className="py-3 text-right font-mono text-sm text-muted-foreground hidden sm:table-cell">{(r.messages ?? 0).toLocaleString('en-US')}</td>
                    )}
                    <td className="py-3 text-right font-bold text-lg">
                      {board === 'improved' ? `+${formatGold(r.value)}` : r.value.toLocaleString('en-US')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
