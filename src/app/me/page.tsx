'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertTriangle,
  ArrowUpCircle,
  CalendarDays,
  Coins,
  Flame,
  History,
  Loader2,
  Map as MapIcon,
  Sparkles,
  Swords,
  Target,
  Users,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import type { MeSummary, MeSummaryResult } from '@/lib/me-summary';

const fmt = (n: number) => n.toLocaleString('en-US');
const compact = (n: number) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(1)}k` : fmt(n);
const prettyDate = (d: string) =>
  new Date(d.length === 10 ? d + 'T12:00:00Z' : d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const title = (s: string | null) => (s ? s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ') : '');

const WARN_STYLE: Record<string, string> = {
  safe: 'bg-green-500/15 text-green-500 border-green-500/40',
  warn1: 'bg-amber-500/15 text-amber-400 border-amber-500/40',
  warn2: 'bg-orange-500/15 text-orange-400 border-orange-500/40',
  kick: 'bg-red-500/15 text-red-500 border-red-500/40',
};
const WARN_LABEL: Record<string, string> = { safe: 'Safe', warn1: 'Warning 1', warn2: 'Warning 2', kick: 'Kick risk' };
const TONE_DOT: Record<string, string> = {
  good: 'bg-green-500',
  bad: 'bg-red-500',
  warn: 'bg-amber-500',
  info: 'bg-sky-500',
};
const HEAT = ['bg-muted', 'bg-sky-900', 'bg-sky-600', 'bg-sky-400'];

function Tile({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-4 space-y-1">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {icon}
          {label}
        </div>
        <div className="text-2xl font-bold tabular-nums">{value}</div>
        {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function useCountdown(iso: string | undefined) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  if (!iso) return '';
  const ms = Math.max(0, new Date(iso).getTime() - now);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}

function Heatmap({ days }: { days: MeSummary['heatmap'] }) {
  // Columns = weeks (Mon..Sun), aligned so the last column holds today.
  const weeks = useMemo(() => {
    const first = new Date(days[0].date + 'T00:00:00Z').getUTCDay() || 7; // Mon=1
    const padded: (MeSummary['heatmap'][number] | null)[] = [...Array(first - 1).fill(null), ...days];
    const cols: (MeSummary['heatmap'][number] | null)[][] = [];
    for (let i = 0; i < padded.length; i += 7) cols.push(padded.slice(i, i + 7));
    return cols;
  }, [days]);
  const label = ['No activity', 'Some activity', 'Requirement met', 'Met 2× or more'];
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <div className="flex gap-[3px] w-max">
          {weeks.map((w, i) => (
            <div key={i} className="flex flex-col gap-[3px]">
              {w.map((d, j) =>
                d ? (
                  <div
                    key={j}
                    title={`${prettyDate(d.date)}: ${label[d.level]}`}
                    className={`h-[11px] w-[11px] rounded-[2px] ${HEAT[d.level]}`}
                  />
                ) : (
                  <div key={j} className="h-[11px] w-[11px]" />
                )
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        Less
        {HEAT.map((c, i) => (
          <div key={i} className={`h-[11px] w-[11px] rounded-[2px] ${c}`} title={label[i]} />
        ))}
        More
      </div>
    </div>
  );
}

export default function MePage() {
  const { user, loading, currentCharacter } = useAuth();
  const [focusId, setFocusId] = useState<string | null>(null);
  const [data, setData] = useState<MeSummaryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const wanted = focusId ?? currentCharacter?.member_id ?? null;

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setBusy(true);
    setError(null);
    fetch(`/api/me/summary${wanted ? `?member_id=${wanted}` : ''}`, { cache: 'no-store' })
      .then(async (r) => {
        const j = await r.json();
        if (cancelled) return;
        if (!r.ok) setError(j.error ?? 'Failed to load');
        else setData(j);
      })
      .catch(() => !cancelled && setError('Failed to load'))
      .finally(() => !cancelled && setBusy(false));
    return () => {
      cancelled = true;
    };
  }, [user, wanted]);

  const req = data && data.claimed ? data.requirement : null;
  const countdown = useCountdown(req?.period === 'weekly' && req.week_end ? undefined : req?.resets_at);

  if (loading || (user && !data && !error)) return <Loader2 className="h-6 w-6 animate-spin mx-auto mt-16" />;
  if (!user) {
    return (
      <div className="max-w-xl mx-auto py-16 text-center space-y-3">
        <p>Sign in to see your personal dashboard.</p>
        <Link href="/login"><Button>Sign in</Button></Link>
      </div>
    );
  }
  if (error) return <p className="text-center text-red-500 mt-16">{error}</p>;
  if (!data) return null;

  if (!data.claimed) {
    return (
      <div className="max-w-xl mx-auto py-16 text-center space-y-3">
        <Sparkles className="h-8 w-8 mx-auto text-sky-400" />
        {data.pending ? (
          <p>Your claim on <b>{data.pending.ign}</b> is waiting for an officer. Your dashboard unlocks once it's approved.</p>
        ) : (
          <p>Claim your IdleMMO character to unlock your personal dashboard.</p>
        )}
        <Link href="/account"><Button>{data.pending ? 'View claim' : 'Claim character'}</Button></Link>
      </div>
    );
  }

  const { focus, tiles, streak, inactivity, nudge } = data;
  const pct = req ? Math.min(100, Math.round((req.contributed / Math.max(1, req.required)) * 100)) : 0;
  const metPct = tiles.days_logged ? Math.round((tiles.days_met / tiles.days_logged) * 100) : 0;

  return (
    <div className={`max-w-6xl mx-auto space-y-4 ${busy ? 'opacity-70 transition-opacity' : ''}`}>
      {/* B1 Hero */}
      <Card className="overflow-hidden">
        <div className="bg-gradient-to-r from-sky-950 via-slate-900 to-slate-950 p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-4">
            {focus.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={focus.avatar_url} alt="" className="h-16 w-16 rounded-full border-2 border-sky-400/60 object-cover" />
            ) : (
              <div className="h-16 w-16 rounded-full border-2 border-sky-400/60 bg-slate-800 flex items-center justify-center text-2xl font-bold text-sky-300">
                {focus.ign.charAt(0)}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl sm:text-3xl font-bold text-white truncate">{focus.ign}</h1>
              <div className="flex flex-wrap items-center gap-2 mt-1 text-sm text-sky-100/80">
                <span>Level {fmt(focus.total_level ?? 0)}</span>
                {focus.class && <span>· {title(focus.class)}</span>}
                {focus.in_dream_guild ? (
                  <span>· {focus.guild_name}{focus.position ? ` (${title(focus.position)})` : ''}</span>
                ) : (
                  <Badge variant="outline" className="border-amber-500/50 text-amber-400">Not in a Dream guild</Badge>
                )}
              </div>
              {focus.first_seen && <div className="text-xs text-sky-100/60 mt-1">Tracked since {prettyDate(focus.first_seen)}</div>}
            </div>
            {inactivity && (
              <Badge variant="outline" className={WARN_STYLE[inactivity.warning_level]}>
                {inactivity.exempt ? 'Exempt (leadership)' : WARN_LABEL[inactivity.warning_level]}
              </Badge>
            )}
          </div>
        </div>
      </Card>

      {/* B2 Stat tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile icon={<Coins className="h-3.5 w-3.5" />} label="Lifetime gold" value={compact(tiles.lifetime_gold)} sub={`${compact(tiles.gold_30d)} last 30 days`} />
        <Tile icon={<Target className="h-3.5 w-3.5" />} label="Lifetime raids" value={fmt(tiles.lifetime_raids)} sub={`${fmt(tiles.raids_30d)} last 30 days`} />
        <Tile icon={<CalendarDays className="h-3.5 w-3.5" />} label="Days met" value={fmt(tiles.days_met)} sub={`${metPct}% of ${fmt(tiles.days_logged)} logged days`} />
        <Tile icon={<Swords className="h-3.5 w-3.5" />} label="Assault kills" value={compact(tiles.assault_kills)} sub={`${fmt(tiles.assault_runs)} runs · ${compact(tiles.assault_experience)} exp`} />
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        {/* B3 Today's requirement */}
        <Card className="md:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Target className="h-4 w-4 text-sky-400" />
              {req?.period === 'weekly' ? "This week's requirement" : "Today's requirement"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!req ? (
              <p className="text-sm text-muted-foreground">No requirement: {focus.ign} isn't in a Dream guild right now.</p>
            ) : (
              <div className="space-y-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-2xl font-bold tabular-nums">
                    {fmt(req.contributed)} <span className="text-base font-normal text-muted-foreground">/ {fmt(req.required)} gold</span>
                  </span>
                  {req.met ? (
                    <Badge variant="outline" className={WARN_STYLE.safe}>Met</Badge>
                  ) : (
                    <Badge variant="outline" className={WARN_STYLE.warn1}>{fmt(Math.max(0, req.required - req.contributed))} to go</Badge>
                  )}
                </div>
                <div className="h-3 rounded-full bg-muted overflow-hidden">
                  <div className={`h-full ${req.met ? 'bg-green-500' : 'bg-sky-500'}`} style={{ width: `${req.met ? 100 : pct}%` }} />
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {req.period === 'weekly' ? (
                    <span>Week ends {prettyDate(req.week_end!)}{req.deposits_only ? ' · guild hall deposits only' : ''}</span>
                  ) : (
                    <span>Game day resets in {countdown} (11:50 UTC)</span>
                  )}
                  <span>{fmt(req.raids)} raid{req.raids === 1 ? '' : 's'}</span>
                  {req.overflow_enabled && <span>Overflow bank: {fmt(req.bank_balance)} gold</span>}
                </div>
                <p className="text-xs text-muted-foreground">Updates each time the activity log syncs, so recent donations can take a little while to show.</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* B4 Streak */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Flame className="h-4 w-4 text-orange-400" />
              Streak
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="text-4xl font-bold tabular-nums">
              {streak.current}
              <span className="text-base font-normal text-muted-foreground"> {streak.unit}{streak.current === 1 ? '' : 's'}</span>
            </div>
            <div className="text-sm text-muted-foreground">Best: {streak.best} {streak.unit}{streak.best === 1 ? '' : 's'}</div>
            {inactivity && !inactivity.exempt && inactivity.days_inactive > 0 && (
              <div className="text-xs text-muted-foreground">
                {inactivity.days_inactive} day{inactivity.days_inactive === 1 ? '' : 's'} since requirement last met
                {inactivity.last_met ? ` (${prettyDate(inactivity.last_met)})` : ''}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* B6 Heatmap */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-sky-400" />
            Activity, last 12 months
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Heatmap days={data.heatmap} />
        </CardContent>
      </Card>

      {/* B8 Move-up nudge */}
      {nudge && (
        <Card className={nudge.kind === 'eligible' ? 'border-sky-500/50' : ''}>
          <CardContent className="p-4 flex items-center gap-3">
            <ArrowUpCircle className={`h-6 w-6 shrink-0 ${nudge.kind === 'eligible' ? 'text-sky-400' : 'text-muted-foreground'}`} />
            {nudge.kind === 'eligible' ? (
              <p className="text-sm">
                You meet the level {fmt(nudge.min_level)} minimum for <b>{nudge.guild_name}</b>. Ask an officer about moving up.
              </p>
            ) : (
              <div className="flex-1 space-y-1">
                <p className="text-sm">
                  <b>{fmt(nudge.levels_needed)}</b> level{nudge.levels_needed === 1 ? '' : 's'} until <b>{nudge.guild_name}</b> (min {fmt(nudge.min_level)}).
                </p>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div className="h-full bg-sky-500" style={{ width: `${Math.min(100, ((focus.total_level ?? 0) / nudge.min_level) * 100)}%` }} />
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        {/* B5 Activity feed */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <History className="h-4 w-4 text-sky-400" />
              Recent activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.feed.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing logged yet.</p>
            ) : (
              <ul className="space-y-2.5">
                {data.feed.map((f, i) => (
                  <li key={i} className="flex gap-3 text-sm">
                    <span className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${TONE_DOT[f.tone]}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex justify-between gap-2">
                        <span className="font-medium">{f.title}</span>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">{prettyDate(f.at)}</span>
                      </div>
                      {f.detail && <div className="text-xs text-muted-foreground truncate">{f.detail}</div>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          {/* B7 Guild journey */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <MapIcon className="h-4 w-4 text-sky-400" />
                Guild journey
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.journey.length === 0 ? (
                <p className="text-sm text-muted-foreground">No guild history yet.</p>
              ) : (
                <ol className="relative border-l border-border ml-1.5 space-y-3">
                  {data.journey.map((j) => (
                    <li key={j.guild_id} className="pl-4">
                      <span className={`absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full ${j.current ? 'bg-sky-400' : 'bg-muted-foreground/50'}`} />
                      <div className="text-sm font-medium">
                        {j.name} {j.current && <Badge variant="outline" className="ml-1 text-[10px] py-0">Current</Badge>}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {prettyDate(j.from)} – {j.current ? 'now' : prettyDate(j.to)} · {fmt(j.days_logged)} days logged
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>

          {/* B9 Alts */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="h-4 w-4 text-sky-400" />
                Your characters
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {data.alts.map((c) => (
                <button
                  key={c.member_id}
                  onClick={() => setFocusId(c.member_id)}
                  className={`w-full flex items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted ${c.is_focus ? 'bg-muted' : ''}`}
                >
                  {c.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.avatar_url} alt="" className="h-7 w-7 rounded-full object-cover" />
                  ) : (
                    <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center text-xs">{c.ign.charAt(0)}</div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">
                      {c.ign} {c.claimed && <span className="text-[10px] text-sky-400 ml-1">MAIN</span>}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Lv {fmt(c.total_level ?? 0)} · {c.in_dream_guild ? c.guild_nickname ?? c.guild_name : 'outside Dream'}
                      {c.last_seen ? ` · seen ${prettyDate(c.last_seen)}` : ''}
                    </div>
                  </div>
                </button>
              ))}
              <p className="text-xs text-muted-foreground pt-1">Click a character to view its dashboard.</p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* B10 Warnings */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            Warnings
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.warnings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No warnings on any of your characters. Keep it up.</p>
          ) : (
            <ul className="divide-y divide-border">
              {data.warnings.map((w) => (
                <li key={w.id} className="py-2 flex items-center gap-3 text-sm">
                  <Badge variant="outline" className={WARN_STYLE[w.warning_level] ?? ''}>{w.warning_level === 'kick' ? 'Kick' : WARN_LABEL[w.warning_level] ?? w.warning_level}</Badge>
                  <span className="font-medium">{w.ign}</span>
                  {w.guild_nickname && <span className="text-muted-foreground">{w.guild_nickname}</span>}
                  <span className="text-muted-foreground truncate flex-1">{w.reason}</span>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">{prettyDate(w.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
