'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Ticket } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MAX_LEVEL, PASS_SOURCES, SOURCE_ORDER, seasonEnd, seasonLabel } from '@/lib/dream-pass';
import type { AccountPass } from '@/lib/dream-pass-account';

type Data = ({ claimed: true } & AccountPass) | { claimed: false };

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

function Bar({ value, max, tone = 'bg-crystal' }: { value: number; max: number; tone?: string }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

const daysLeft = (season: string) => Math.max(0, Math.ceil((Date.parse(`${seasonEnd(season)}T00:00:00Z`) - Date.now()) / 86_400_000));

/** Dream Pass (step 15): season level + XP breakdown, lifetime Dream XP + rank, Discord level. */
export default function PassCard({ src = '/api/me/pass', readOnly = false }: { src?: string; readOnly?: boolean } = {}) {
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(src, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: Data) => !cancelled && setData(d))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [src]);

  if (failed || (data && !data.claimed)) return null;
  const p = data?.claimed ? data : null;
  const lv = p?.level;
  const sources = p ? SOURCE_ORDER.filter((k) => (p.breakdown[k] ?? 0) > 0).sort((a, b) => (p.breakdown[b] ?? 0) - (p.breakdown[a] ?? 0)) : [];
  const unused = p ? SOURCE_ORDER.filter((k) => !(p.breakdown[k] ?? 0)) : [];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex flex-wrap items-center gap-2">
          <Ticket className="h-4 w-4 text-crystal" />
          Dream Pass
          {p && (
            <span className="text-sm font-normal text-muted-foreground">
              {seasonLabel(p.season)} · {daysLeft(p.season)} days left
            </span>
          )}
          <Link href="/leaderboard" className="ml-auto text-xs font-normal text-muted-foreground hover:text-foreground underline-offset-4 hover:underline">
            Season board
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!p || !lv ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading the Dream Pass…
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-[1.4fr_1fr]">
            {/* Season */}
            <div className="space-y-4">
              <div className="flex items-end gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Level</p>
                  <p className="text-5xl font-bold tabular-nums leading-none text-crystal-light">
                    {lv.level}
                    {lv.stars > 0 && <span className="ml-2 text-2xl text-amber-400">★{lv.stars}</span>}
                  </p>
                </div>
                <div className="flex-1 space-y-1 pb-1">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{fmt(p.xp)} XP this season</span>
                    <span>
                      {lv.level >= MAX_LEVEL ? `${fmt(lv.need - lv.into)} to next ★` : `${fmt(lv.need - lv.into)} to level ${lv.level + 1}`}
                    </span>
                  </div>
                  <Bar value={lv.into} max={lv.need} />
                  <p className="text-xs text-muted-foreground">
                    {p.place ? <>#{p.place} of {p.players} this season{p.place <= 10 ? ' · Season Champion pace 🏆' : ''}</> : 'No XP yet this season'}
                    {p.previous && <> · {seasonLabel(p.previous.season)}: level {p.previous.level} ({fmt(p.previous.xp)} XP)</>}
                  </p>
                </div>
              </div>

              {sources.length > 0 && (
                <ul className="space-y-1.5 text-sm">
                  {sources.map((k) => (
                    <li key={k} className="flex items-center gap-2" title={PASS_SOURCES[k].hint}>
                      <span className="w-5 text-center">{PASS_SOURCES[k].emoji}</span>
                      <span className="flex-1">{PASS_SOURCES[k].label}</span>
                      <span className="font-mono tabular-nums">{fmt(p.breakdown[k] ?? 0)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {!readOnly && unused.length > 0 && (
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer select-none">How else to earn XP</summary>
                  <ul className="mt-2 space-y-1">
                    {unused.map((k) => (
                      <li key={k}>
                        {PASS_SOURCES[k].emoji} <span className="text-foreground">{PASS_SOURCES[k].label}</span> · {PASS_SOURCES[k].hint}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>

            {/* Lifetime + Discord */}
            <div className="space-y-4">
              <div className="rounded-md border p-3 space-y-1.5">
                <p className="text-xs text-muted-foreground">Lifetime Dream XP</p>
                <p className="text-2xl font-bold tabular-nums">
                  {fmt(p.lifetime)}
                  {p.lifetime_place && <span className="ml-2 text-xs font-normal text-muted-foreground">#{p.lifetime_place}</span>}
                </p>
                <p className="text-sm">
                  {p.rank ? <span className="font-medium">{p.rank.emoji} {p.rank.name}</span> : <span className="text-muted-foreground">No rank yet</span>}
                  {p.next_rank && <span className="text-xs text-muted-foreground"> · {fmt(p.next_rank.min - p.lifetime)} to {p.next_rank.emoji} {p.next_rank.name}</span>}
                </p>
                {p.next_rank && <Bar value={p.lifetime - (p.rank?.min ?? 0)} max={p.next_rank.min - (p.rank?.min ?? 0)} tone="bg-violet-400" />}
                {p.champion.length > 0 && (
                  <p className="text-xs text-amber-400">
                    🏆 {p.champion.map((c) => `${seasonLabel(c.season)} #${c.place}`).join(' · ')}
                  </p>
                )}
              </div>

              <div className="rounded-md border p-3 space-y-1.5">
                <p className="text-xs text-muted-foreground">Discord level</p>
                {p.discord.linked ? (
                  <>
                    <p className="text-2xl font-bold tabular-nums">{p.discord.level}</p>
                    <Bar value={p.discord.into} max={p.discord.need} tone="bg-indigo-400" />
                    <p className="text-xs text-muted-foreground">
                      {fmt(p.discord.messages)} messages · {fmt(p.discord.bumps)} bumps · {fmt(p.discord.need - p.discord.into)} XP to level {p.discord.level + 1}
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {readOnly ? 'Discord not linked.' : <>Link your Discord with <span className="font-mono">/claim</span> to earn chat XP.</>}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
