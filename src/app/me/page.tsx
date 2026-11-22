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

type Scope = { guild_id?: string; member_id?: string } | null;

function Avatar({ url, name, size = 'h-7 w-7' }: { url: string | null; name: string; size?: string }) {
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" className={`${size} rounded-full object-cover`} />
  ) : (
    <div className={`${size} rounded-full bg-muted flex items-center justify-center text-xs`}>{name.charAt(0)}</div>
  );
}

function NudgeLine({ c }: { c: MeSummary['characters'][number] }) {
  const n = c.nudge;
  if (!n) return null;
  if (n.kind === 'assault')
    return <span>Want hardcore assaults? Ask an officer about moving to <b className="text-foreground">{n.guild_name}</b>{n.levels_needed > 0 ? ` (CL ${n.min_level}, ${n.levels_needed} to go)` : ''}.</span>;
  if (n.kind === 'eligible')
    return <span>Meets the CL {n.min_level} requirement for <b className="text-foreground">{n.guild_name}</b>. Ask an officer about moving up.</span>;
  return <span>{n.levels_needed} CL until <b className="text-foreground">{n.guild_name}</b> (CL {n.min_level}).</span>;
}

export default function MePage() {
  const { user, loading } = useAuth();
  const [scopeSel, setScopeSel] = useState<Scope>(null); // null = whole account
  const [data, setData] = useState<MeSummaryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setBusy(true);
    setError(null);
    const qs = scopeSel?.guild_id ? `?guild_id=${scopeSel.guild_id}` : scopeSel?.member_id ? `?member_id=${scopeSel.member_id}` : '';
    fetch(`/api/me/summary${qs}`, { cache: 'no-store' })
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
  }, [user, scopeSel]);

  const countdown = useCountdown(data && data.claimed ? data.check.next_check_at : undefined);

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
          <p>Your claim on <b>{data.pending.ign}</b> is waiting for an officer. Your dashboard unlocks once it&apos;s approved.</p>
        ) : (
          <p>Claim your IdleMMO character to unlock your personal dashboard.</p>
        )}
        <Link href="/account"><Button>{data.pending ? 'View claim' : 'Claim character'}</Button></Link>
      </div>
    );
  }

  const { main, tiles, status, check, scope, selected, groups, characters } = data;
  const metPct = tiles.days_logged ? Math.round((tiles.days_met / tiles.days_logged) * 100) : 0;
  const inScope = (c: MeSummary['characters'][number]) =>
    scope === 'account' ||
    (scope === 'group' ? c.group_id === selected.guild_id : c.member_id === selected.member_id);
  const scopeChars = characters.filter(inScope);
  const hero = scope === 'character' ? scopeChars[0] ?? main : scope === 'group' ? null : main;

  const chip = (active: boolean) =>
    `px-3 py-1.5 rounded-full text-sm border transition-colors ${active ? 'bg-sky-500/20 border-sky-500/60 text-sky-200' : 'border-border hover:bg-muted'}`;

  return (
    <div className={`max-w-6xl mx-auto space-y-4 ${busy ? 'opacity-70 transition-opacity' : ''}`}>
      {/* B1 Hero */}
      <Card className="overflow-hidden">
        <div className="bg-gradient-to-r from-sky-950 via-slate-900 to-slate-950 p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-4">
            {hero ? (
              <Avatar url={hero.avatar_url} name={hero.ign} size="h-16 w-16 border-2 border-sky-400/60" />
            ) : (
              <div className="flex -space-x-3">
                {scopeChars.slice(0, 5).map((c) => (
                  <Avatar key={c.member_id} url={c.avatar_url} name={c.ign} size="h-12 w-12 border-2 border-slate-900" />
                ))}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl sm:text-3xl font-bold text-white truncate">{hero ? hero.ign : selected.label}</h1>
              <div className="flex flex-wrap items-center gap-2 mt-1 text-sm text-sky-100/80">
                {hero ? (
                  <>
                    {hero.combat_level != null && <span>CL {fmt(hero.combat_level)} ·</span>}
                    <span>Total level {fmt(hero.total_level ?? 0)}</span>
                    {hero.class && <span>· {title(hero.class)}</span>}
                    {hero.in_dream_guild ? (
                      <span>· {hero.guild_name}{hero.position ? ` (${title(hero.position)})` : ''}</span>
                    ) : (
                      <Badge variant="outline" className="border-amber-500/50 text-amber-400">Not in a Dream guild</Badge>
                    )}
                  </>
                ) : (
                  <span>{scopeChars.map((c) => c.ign).join(', ')}</span>
                )}
              </div>
              <div className="text-xs text-sky-100/60 mt-1">
                {scope === 'account'
                  ? `Whole account · ${characters.length} character${characters.length === 1 ? '' : 's'}`
                  : scope === 'group'
                    ? 'Characters in the same guild count as one member: any of them meeting the requirement covers all.'
                    : 'Single character (no active Dream guild requirement)'}
              </div>
            </div>
            {status.has_requirement && (
              <Badge variant="outline" className={WARN_STYLE[status.warning_level]}>
                {status.exempt ? 'Exempt (leadership)' : WARN_LABEL[status.warning_level]}
              </Badge>
            )}
          </div>
        </div>
      </Card>

      {/* Scope switcher */}
      <div className="flex flex-wrap gap-2">
        <button className={chip(scope === 'account')} onClick={() => setScopeSel(null)}>Whole account</button>
        {data.switcher.map((o) => {
          const active = o.guild_id ? scope === 'group' && selected.guild_id === o.guild_id : scope === 'character' && selected.member_id === o.member_id;
          return (
            <button
              key={o.guild_id ?? o.member_id}
              className={chip(active)}
              onClick={() => setScopeSel(o.guild_id ? { guild_id: o.guild_id } : { member_id: o.member_id! })}
            >
              {o.label}
            </button>
          );
        })}
      </div>

      {/* B2 Stat tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile icon={<Coins className="h-3.5 w-3.5" />} label="Lifetime gold" value={compact(tiles.lifetime_gold)} sub={`${compact(tiles.gold_30d)} last 30 days`} />
        <Tile icon={<Target className="h-3.5 w-3.5" />} label="Lifetime raids" value={fmt(tiles.lifetime_raids)} sub={`${fmt(tiles.raids_30d)} last 30 days`} />
        <Tile icon={<CalendarDays className="h-3.5 w-3.5" />} label="Days met" value={fmt(tiles.days_met)} sub={`${metPct}% of ${fmt(tiles.days_logged)} logged days`} />
        <Tile icon={<Swords className="h-3.5 w-3.5" />} label="Assault kills" value={compact(tiles.assault_kills)} sub={`${fmt(tiles.assault_runs)} runs · ${compact(tiles.assault_experience)} exp`} />
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        {/* B3 Daily check, one row per guild group */}
        <Card className="md:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Target className="h-4 w-4 text-sky-400" />
              Daily check
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Activity is checked once a day at 11:48 UTC. Next check in <b>{countdown}</b>. Results are for the game day of {prettyDate(check.checked_day)}.
            </p>
            {groups.length === 0 ? (
              <p className="text-sm text-muted-foreground">No requirement: not in a Dream guild right now.</p>
            ) : (
              <ul className="divide-y divide-border">
                {groups.map((g) => {
                  const best = Math.max(0, ...g.members.map((m) => m.contributed));
                  const pct = Math.min(100, Math.round((best / Math.max(1, g.required)) * 100));
                  return (
                    <li key={g.guild_id} className="py-2.5 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-medium">{g.guild_name}</span>
                        <span className="text-xs text-muted-foreground">
                          {g.period === 'weekly' ? `weekly${g.deposits_only ? ', deposits only' : ''}` : 'daily'} · {fmt(g.required)} gold
                        </span>
                        <span className="flex-1" />
                        {g.exempt ? (
                          <Badge variant="outline" className={WARN_STYLE.safe}>Exempt</Badge>
                        ) : (
                          <>
                            <Badge variant="outline" className={g.met ? WARN_STYLE.safe : WARN_STYLE.warn1}>
                              {g.met ? 'Met' : g.period === 'weekly' ? `${fmt(Math.max(0, g.required - best))} to go` : 'Missed'}
                            </Badge>
                            {g.warning_level !== 'safe' && <Badge variant="outline" className={WARN_STYLE[g.warning_level]}>{WARN_LABEL[g.warning_level]}</Badge>}
                          </>
                        )}
                      </div>
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div className={`h-full ${g.met ? 'bg-green-500' : 'bg-sky-500'}`} style={{ width: `${g.met ? 100 : pct}%` }} />
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                        {g.members.map((m) => (
                          <span key={m.member_id} className={m.met ? 'text-green-500' : ''}>
                            {m.ign}: {fmt(m.contributed)}{m.met ? ' ✓' : ''}{m.bank_balance ? ` (bank ${fmt(m.bank_balance)})` : ''}
                          </span>
                        ))}
                        {g.period === 'weekly' && g.week_end && <span>Week ends {prettyDate(g.week_end)}</span>}
                        {!g.exempt && g.days_inactive > 0 && (
                          <span>{g.days_inactive >= 999 ? 'Never met' : `${g.days_inactive} day${g.days_inactive === 1 ? '' : 's'} since last met`}</span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* B4 Streak, per guild group */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Flame className="h-4 w-4 text-orange-400" />
              Streak
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.streak ? (
              <div>
                <div className="text-4xl font-bold tabular-nums">{data.streak.current}<span className="text-base font-normal text-muted-foreground"> days</span></div>
                <div className="text-sm text-muted-foreground">Best: {data.streak.best} days</div>
              </div>
            ) : groups.length === 0 ? (
              <p className="text-sm text-muted-foreground">No guild requirement to streak.</p>
            ) : (
              groups.map((g) => (
                <div key={g.guild_id}>
                  {groups.length > 1 && <div className="text-xs text-muted-foreground">{g.guild_nickname ?? g.guild_name}</div>}
                  <div className={`${groups.length > 1 ? 'text-2xl' : 'text-4xl'} font-bold tabular-nums`}>
                    {g.streak.current}
                    <span className="text-base font-normal text-muted-foreground"> {g.streak.unit}{g.streak.current === 1 ? '' : 's'}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">Best: {g.streak.best} {g.streak.unit}{g.streak.best === 1 ? '' : 's'}</div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Raids + moving up, per character (moving guild is per character, by combat level) */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <ArrowUpCircle className="h-4 w-4 text-sky-400" />
            Raids and moving up
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {groups.map((g) => (
            <div key={g.guild_id} className="text-xs text-muted-foreground">
              <b className="text-foreground">{g.guild_nickname ?? g.guild_name}</b> runs{' '}
              {g.raids.length ? g.raids.map((r) => `${r.name} (CL ${r.min_cl}, ${r.minutes} min, ${r.marks} marks)`).join(', ') : 'no raid set yet'}
            </div>
          ))}
          <ul className="space-y-2">
            {scopeChars.map((c) => (
              <li key={c.member_id} className="flex items-start gap-3">
                <Avatar url={c.avatar_url} name={c.ign} />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">
                    {c.ign}{' '}
                    <span className="text-xs font-normal text-muted-foreground">
                      {c.combat_level != null ? `CL ${c.combat_level}` : 'CL not synced yet'} · {c.in_dream_guild ? c.guild_nickname ?? c.guild_name : 'outside Dream'}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground space-x-1">
                    {c.best_raid && <span>Can join up to {c.best_raid.name}.</span>}
                    <NudgeLine c={c} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

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
                      {f.detail && <div className="text-xs text-muted-foreground">{f.detail}</div>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          {/* B9 Characters */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="h-4 w-4 text-sky-400" />
                Your characters
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {characters.map((c) => (
                <button
                  key={c.member_id}
                  onClick={() => setScopeSel(c.group_id ? { guild_id: c.group_id } : { member_id: c.member_id })}
                  className={`w-full flex items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted ${scope !== 'account' && inScope(c) ? 'bg-muted' : ''}`}
                >
                  <Avatar url={c.avatar_url} name={c.ign} />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">
                      {c.ign} {c.claimed && <span className="text-[10px] text-sky-400 ml-1">MAIN</span>}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {c.combat_level != null ? `CL ${c.combat_level} · ` : ''}Lv {fmt(c.total_level ?? 0)} · {c.in_dream_guild ? c.guild_nickname ?? c.guild_name : 'outside Dream'}
                      {c.last_seen ? ` · seen ${prettyDate(c.last_seen)}` : ''}
                    </div>
                  </div>
                </button>
              ))}
              <p className="text-xs text-muted-foreground pt-1">Clicking a character opens its guild, with any alts there.</p>
            </CardContent>
          </Card>

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
                    <li key={`${j.member_id}-${j.guild_id}`} className="pl-4">
                      <span className={`absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full ${j.current ? 'bg-sky-400' : 'bg-muted-foreground/50'}`} />
                      <div className="text-sm font-medium">
                        {scopeChars.length > 1 && <span className="text-muted-foreground font-normal">{j.ign} · </span>}
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
            <p className="text-sm text-muted-foreground">No warnings here. Keep it up.</p>
          ) : (
            <ul className="divide-y divide-border">
              {data.warnings.map((w) => (
                <li key={w.id} className="py-2 flex items-center gap-3 text-sm">
                  <Badge variant="outline" className={WARN_STYLE[w.warning_level] ?? ''}>
                    {w.warning_level === 'kick' ? 'Kick' : WARN_LABEL[w.warning_level] ?? w.warning_level}
                  </Badge>
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
