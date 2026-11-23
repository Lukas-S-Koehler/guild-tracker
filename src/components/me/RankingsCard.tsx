'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Medal, Swords, Trophy } from 'lucide-react';
import type { MeRankings, Rank } from '@/lib/me-rankings';

const compact = (n: number) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(1)}k` : n.toLocaleString('en-US');

function rankTone(r: Rank) {
  if (r.rank === 1) return 'text-yellow-400';
  if (r.rank <= 3) return 'text-crystal-light';
  if (r.rank <= 10) return 'text-crystal';
  return 'text-foreground';
}

function RankCell({ label, r, detail }: { label: string; r: Rank | null; detail?: string }) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      {r ? (
        <>
          <p className={`text-xl font-bold ${rankTone(r)}`}>
            #{r.rank}
            <span className="text-xs font-normal text-muted-foreground"> of {r.of}</span>
          </p>
          {detail && <p className="text-xs text-muted-foreground truncate">{detail}</p>}
        </>
      ) : (
        <p className="text-sm text-muted-foreground mt-1">Not ranked yet</p>
      )}
    </div>
  );
}

/** Account-wide leaderboard ranks: activity and assault. Loads on its own (assault data is slow). */
export default function RankingsCard({ src = '/api/me/rankings' }: { src?: string } = {}) {
  const [data, setData] = useState<MeRankings | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(src, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: MeRankings) => !cancelled && setData(d))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [src]);

  if (failed || (data && !data.claimed)) return null;
  const a = data?.activity;
  const act = (r: { raids: number; gold: number; value: number } | null | undefined) =>
    r ? `${compact(r.value)} score · ${r.raids.toLocaleString()} raids · ${compact(r.gold)} gold` : undefined;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Medal className="h-4 w-4 text-crystal" />
          Leaderboard rankings
          <span className="text-xs font-normal text-muted-foreground">· whole account</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!data ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium flex items-center gap-1.5"><Trophy className="h-3.5 w-3.5 text-muted-foreground" />Activity</p>
                <Link href="/leaderboard" className="text-xs text-muted-foreground hover:text-foreground">Leaderboard →</Link>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <RankCell label="This week" r={a?.week ?? null} detail={act(a?.week)} />
                <RankCell
                  label={data.guild_week ? `In ${data.guild_week.guild_name} · week` : 'In guild · week'}
                  r={data.guild_week}
                  detail={act(data.guild_week)}
                />
                <RankCell label="This month" r={a?.month ?? null} detail={act(a?.month)} />
                <RankCell label="All time" r={a?.all ?? null} detail={act(a?.all)} />
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium flex items-center gap-1.5"><Swords className="h-3.5 w-3.5 text-muted-foreground" />Assault</p>
                <Link href="/assault/leaderboard" className="text-xs text-muted-foreground hover:text-foreground">Leaderboard →</Link>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <RankCell
                  label={`Season ${data.assault.season}`}
                  r={data.assault.season_rank}
                  detail={data.assault.season_rank ? `${compact(data.assault.season_rank.value)} XP · ${data.assault.season_rank.kills.toLocaleString()} kills` : undefined}
                />
                <RankCell
                  label="All time"
                  r={data.assault.all_time}
                  detail={data.assault.all_time ? `${compact(data.assault.all_time.value)} XP · ${data.assault.all_time.kills.toLocaleString()} kills` : undefined}
                />
              </div>
              <p className="text-xs text-muted-foreground">Ranked by assault XP across the Dream guilds.</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
