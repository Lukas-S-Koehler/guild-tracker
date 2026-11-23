'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { ArrowRight, CheckSquare, Medal, Star, Swords, Waves, Zap } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import type { MeAssault } from '@/lib/me-assault';

const compact = (n: number) => Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);

function Stat({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">{icon}{label}</div>
      <div className="text-xl font-bold tabular-nums leading-tight">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground truncate">{sub}</div>}
    </div>
  );
}

/** Personal season summary at the top of /assault. Signed-in members with a claim only; links to /me/assault. */
export default function MyAssaultStrip() {
  const { user } = useAuth();
  const [data, setData] = useState<MeAssault | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    fetch('/api/me/assault', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: MeAssault) => !cancelled && setData(d))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (!user || failed || (data && !data.claimed)) return null;

  const shell = (body: React.ReactNode) => (
    <Link href="/me/assault" className="block group">
      <Card className="border-crystal/30 bg-gradient-to-r from-crystal/10 via-transparent to-orange-500/10 transition-colors group-hover:border-crystal/60">
        <CardContent className="p-4">{body}</CardContent>
      </Card>
    </Link>
  );

  const header = (season?: number) => (
    <div className="flex items-center gap-2 mb-3">
      <Swords className="h-4 w-4 text-crystal" />
      <span className="font-semibold">My assault</span>
      {season != null && <span className="text-xs text-muted-foreground">· season {season} · whole account</span>}
      <span className="ml-auto text-xs text-muted-foreground group-hover:text-foreground flex items-center gap-1">
        Details <ArrowRight className="h-3 w-3" />
      </span>
    </div>
  );

  if (!data) {
    return shell(
      <>
        {header()}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <div className="h-3 w-16 rounded bg-muted animate-pulse" />
              <div className="h-6 w-20 rounded bg-muted animate-pulse" />
            </div>
          ))}
        </div>
      </>
    );
  }

  const { totals, attendance, ranks, zones, best_wave, guilds } = data;
  const next = guilds.find((g) => g.next_launch_unix && g.checklist && g.checklist.total > 0);
  const nothing = totals.experience === 0 && totals.kills === 0;

  if (nothing) {
    return shell(
      <>
        {header(data.season)}
        <p className="text-sm text-muted-foreground">
          {guilds.length
            ? 'No contributions yet this season. Your numbers, waves and ranks show up here after your first wave.'
            : 'None of your characters is in an assault guild. Dream Engineers is open to every level.'}
          {next?.checklist && <> Checklist for the next launch: <b className="text-foreground">{next.checklist.done}/{next.checklist.total}</b>.</>}
        </p>
      </>
    );
  }

  const topZone = zones[0];
  const topChar = topZone?.characters[0];
  return shell(
    <>
      {header(data.season)}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        <Stat icon={<Zap className="h-3 w-3" />} label="EXP" value={compact(totals.experience)} sub={`${compact(totals.kills)} kills`} />
        <Stat
          icon={<Medal className="h-3 w-3" />}
          label="Dream rank"
          value={ranks.season ? `#${ranks.season.rank}` : '—'}
          sub={ranks.season ? `of ${ranks.season.of} this season` : undefined}
        />
        <Stat
          icon={<Waves className="h-3 w-3" />}
          label="Waves"
          value={attendance.waves ? `${attendance.attended}/${attendance.waves}` : '—'}
          sub={best_wave ? `best ${compact(best_wave.experience)} · ${best_wave.share_pct}%` : undefined}
        />
        <Stat
          icon={<Star className="h-3 w-3" />}
          label="Top zone"
          value={topChar ? `#${topChar.guild_rank_xp}` : '—'}
          sub={topZone ? `in guild · ${topZone.zone_name}` : undefined}
        />
        <Stat
          icon={<CheckSquare className="h-3 w-3" />}
          label="Checklist"
          value={next?.checklist ? `${next.checklist.done}/${next.checklist.total}` : '—'}
          sub={next ? `next ${next.nickname ?? next.name} launch` : 'no launch scheduled'}
        />
      </div>
    </>
  );
}
