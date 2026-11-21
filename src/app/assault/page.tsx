'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, MapPin, BookOpen, CheckSquare, BarChart3, Settings, Swords, FlaskConical, Trophy, Clock, Landmark, Medal, Globe, Crown } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { DREAM_BADGE_URL } from '@/lib/dream-badge';

interface GuildSummary {
  guild_id: string;
  guild_name: string;
  active: boolean;
  launch_time_utc: string;
  zone_name: string;
  level_range: string;
  shrine_info: string;
  tracked_zone_id: number | null;
  external_guild_id: number | null;
  weekdays: number[] | null;
  season_start: string | null;
  season_end: string | null;
  next_launch_unix: number | null;
  active_run: { ends_at: string; starts_at: string; zone_name: string } | null;
  last_run: { status?: string; starts_at: string; ends_at: string; zone_name: string; total_kills: number; total_experience: number } | null;
}

interface Standings {
  guilds: Array<{
    guild_id: number; guild_name?: string; overall_rank: number | null; of: number; experience: number;
    zones: Array<{ zone_id: number; zone_name: string; position: number; of: number; experience: number }>;
  }>;
  members: Array<{ character_id: number; character_name: string; guild_id: number; experience: number }>;
  best_finishes?: Array<{ zone_id: number; zone_name: string; season_number: number; guild_name: string; position: number; of: number; experience: number; image_url?: string | null }>;
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};
const compact = (n: number) => Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
const pad = (n: number) => String(n).padStart(2, '0');

function CountdownDigits({ targetUnix, nowMs }: { targetUnix: number; nowMs: number }) {
  const total = Math.max(0, Math.floor(targetUnix - nowMs / 1000));
  const d = Math.floor(total / 86400);
  const cells = [
    ...(d > 0 ? [{ v: String(d), l: 'days' }] : []),
    { v: pad(Math.floor((total % 86400) / 3600)), l: 'hrs' },
    { v: pad(Math.floor((total % 3600) / 60)), l: 'min' },
    { v: pad(total % 60), l: 'sec' },
  ];
  return (
    <div className="flex gap-2">
      {cells.map(c => (
        <div key={c.l} className="min-w-[3.5rem] rounded-lg bg-muted/60 border px-2 py-1.5 text-center">
          <div className="text-3xl font-bold tabular-nums leading-none">{c.v}</div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mt-1">{c.l}</div>
        </div>
      ))}
    </div>
  );
}

function WeekdayChips({ days }: { days: number[] | null }) {
  const set = new Set(days ?? []);
  const today = new Date().getUTCDay();
  return (
    <div className="flex gap-1">
      {WEEKDAY_LABELS.map((l, i) => (
        <span
          key={l}
          className={`text-xs rounded px-1.5 py-0.5 border ${set.has(i) ? 'bg-orange-500/15 border-orange-500/50 text-orange-400 font-medium' : 'text-muted-foreground/50 border-transparent'} ${i === today ? 'ring-1 ring-foreground/30' : ''}`}
        >
          {l}
        </span>
      ))}
    </div>
  );
}

function GuildHero({ g, standings, nowMs }: { g: GuildSummary; standings: Standings | null; nowMs: number }) {
  const live = g.active_run && new Date(g.active_run.ends_at).getTime() > nowMs ? g.active_run : null;
  const target = live ? Math.floor(new Date(live.ends_at).getTime() / 1000) : g.next_launch_unix;
  const sg = standings?.guilds.find(x => x.guild_id === g.external_guild_id);
  const zoneRank = sg?.zones.find(z => z.zone_id === g.tracked_zone_id) ?? sg?.zones[0];
  const otherZones = (sg?.zones.length ?? 0) - (zoneRank ? 1 : 0);
  const top3 = (standings?.members ?? []).filter(m => m.guild_id === g.external_guild_id).slice(0, 3);
  const window = g.season_start && g.season_end ? `${g.season_start} → ${g.season_end}` : g.season_start ? `from ${g.season_start}` : g.season_end ? `until ${g.season_end}` : null;

  return (
    <Card className={live ? 'border-orange-500/70 shadow-[0_0_24px_-8px] shadow-orange-500/50' : ''}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <div className="flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={DREAM_BADGE_URL} alt="" className="h-8 w-8 object-contain" />
              <CardTitle className="text-xl">{g.guild_name}</CardTitle>
            </div>
            <CardDescription className="flex gap-1.5 flex-wrap mt-1.5">
              <Badge variant="outline" className="gap-1"><MapPin className="h-3 w-3" />{g.zone_name}</Badge>
              {g.level_range && <Badge variant="outline">Lv {g.level_range}</Badge>}
              {g.shrine_info && <Badge variant="secondary" className="gap-1 font-normal"><Landmark className="h-3 w-3" />{g.shrine_info}</Badge>}
            </CardDescription>
          </div>
          {live ? (
            <Badge className="bg-orange-500 hover:bg-orange-500 gap-1.5">
              <span className="h-2 w-2 rounded-full bg-white animate-pulse" />LIVE
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Timer */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5 flex items-center gap-1">
              <Clock className="h-3 w-3" />{live ? 'Assault ends in' : 'Next assault in'}
            </div>
            {target ? <CountdownDigits targetUnix={target} nowMs={nowMs} /> : (
              <p className="text-sm text-muted-foreground">No upcoming day in window</p>
            )}
          </div>
          {g.next_launch_unix && !live && (
            <div className="text-sm text-right">
              <div className="font-medium">{new Date(g.next_launch_unix * 1000).toLocaleString([], { weekday: 'long', month: 'short', day: 'numeric' })}</div>
              <div className="text-muted-foreground">{new Date(g.next_launch_unix * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} your time · {g.launch_time_utc.slice(0, 5)} UTC</div>
            </div>
          )}
        </div>

        {/* Schedule */}
        <div className="flex items-center gap-3 flex-wrap">
          <WeekdayChips days={g.weekdays} />
          <span className="text-xs text-muted-foreground">@ {g.launch_time_utc.slice(0, 5)} UTC{window ? ` · ${window}` : ''}</span>
        </div>

        {/* Standing / last run / top members */}
        <div className="grid gap-3 sm:grid-cols-3 text-sm">
          <div className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground mb-0.5">Location standing</div>
            {zoneRank ? (
              <>
                <div className="text-2xl font-bold">{ordinal(zoneRank.position)}<span className="text-sm font-normal text-muted-foreground"> / {zoneRank.of}</span></div>
                <div className="text-xs text-muted-foreground truncate">
                  {zoneRank.zone_name}{otherZones > 0 ? ` · +${otherZones} more` : ''}
                </div>
                {sg?.overall_rank && <div className="text-[11px] text-muted-foreground/70 mt-0.5">Overall {ordinal(sg.overall_rank)} of {sg.of}</div>}
              </>
            ) : <div className="text-muted-foreground">—</div>}
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground mb-0.5 flex items-center gap-1.5">
              Last assault
              {g.last_run && g.last_run.status !== 'finalized' && (
                <span title="Data is still being collected; final numbers after the 25h sync" className="inline-flex items-center gap-1 text-[10px] text-amber-400/90">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />not final
                </span>
              )}
            </div>
            {g.last_run ? (
              <>
                <div className="text-2xl font-bold">{compact(g.last_run.total_experience)}<span className="text-sm font-normal text-muted-foreground"> XP</span></div>
                <div className="text-xs text-muted-foreground">{g.last_run.total_kills.toLocaleString()} kills · {new Date(g.last_run.starts_at).toLocaleDateString()}</div>
              </>
            ) : <div className="text-muted-foreground">—</div>}
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground mb-0.5 flex items-center gap-1"><Trophy className="h-3 w-3" />Top assaulters</div>
            {top3.length ? (
              <ol className="text-xs space-y-0.5">
                {top3.map((m, i) => (
                  <li key={m.character_id} className="flex justify-between gap-2">
                    <span className="truncate">{['🥇', '🥈', '🥉'][i]} {m.character_name}</span>
                    <span className="text-muted-foreground tabular-nums">{compact(m.experience)}</span>
                  </li>
                ))}
              </ol>
            ) : <div className="text-muted-foreground">—</div>}
          </div>
        </div>

        <div className="flex gap-2 flex-wrap">
          <Link href="/assault/leaderboard"><Button size="sm"><Medal className="h-4 w-4 mr-1" />Member leaderboard</Button></Link>
          <Link href="/assault/stats"><Button size="sm" variant="outline"><BarChart3 className="h-4 w-4 mr-1" />Season stats</Button></Link>
          <Link href="/assault/checklist"><Button size="sm" variant="outline"><CheckSquare className="h-4 w-4 mr-1" />Checklist</Button></Link>
          <Link href="/assault/locations"><Button size="sm" variant="outline"><MapPin className="h-4 w-4 mr-1" />Locations</Button></Link>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AssaultLandingPage() {
  const { hasRole, isSuperAdmin } = useAuth();
  const canAdmin = isSuperAdmin || hasRole('DEPUTY');
  const [guilds, setGuilds] = useState<GuildSummary[] | null>(null);
  const [standings, setStandings] = useState<Standings | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    fetch('/api/assault/public').then(r => r.json()).then(j => setGuilds(j.guilds ?? [])).catch(() => setGuilds([]));
    fetch('/api/assault/standings').then(r => r.json()).then(j => (j.error ? null : setStandings(j))).catch(() => {});
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const activeGuilds = (guilds ?? [])
    .filter(g => g.active)
    .sort((a, b) => (a.next_launch_unix ?? Infinity) - (b.next_launch_unix ?? Infinity));
  const pausedGuilds = (guilds ?? []).filter(g => !g.active);

  const tools = [
    { href: '/assault/stats', icon: BarChart3, title: 'Stats', desc: 'Season standing, member leaderboards.' },
    { href: '/assault/leaderboard', icon: Medal, title: 'Leaderboard', desc: 'Member assault rankings.' },
    { href: '/assault/conquest', icon: Globe, title: 'Conquest', desc: 'Every location, every guild.' },
    { href: '/assault/locations', icon: MapPin, title: 'Locations', desc: 'Enemies, drops, gold per hour.' },
    { href: '/assault/guide', icon: BookOpen, title: 'Guide', desc: 'Zone info, 5Ps, hits-to-kill, gear.' },
    { href: '/assault/checklist', icon: CheckSquare, title: 'Checklist', desc: 'Track your prep each launch.' },
    { href: '/assault/potions', icon: FlaskConical, title: 'Potions', desc: 'Plan stacks, costs, restacks.' },
    ...(canAdmin ? [{ href: '/assault/admin', icon: Settings, title: 'Admin', desc: 'Schedule, pings, location.' }] : []),
  ];

  return (
    <div className="container mx-auto p-4 max-w-5xl space-y-6">
      <div className="flex items-center gap-2">
        <Swords className="h-7 w-7 text-orange-500" />
        <div>
          <h1 className="text-2xl font-bold">Assault</h1>
          <p className="text-sm text-muted-foreground">Schedule, live timers, standings and prep tools.</p>
        </div>
      </div>

      {!guilds && <Loader2 className="h-5 w-5 animate-spin" />}
      {guilds && activeGuilds.length === 0 && (
        <p className="text-sm text-muted-foreground">No active assault guilds.</p>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {activeGuilds.map(g => <GuildHero key={g.guild_id} g={g} standings={standings} nowMs={nowMs} />)}
      </div>
      {pausedGuilds.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Paused: {pausedGuilds.map(g => g.guild_name).join(', ')}
        </p>
      )}

      {standings?.best_finishes && standings.best_finishes.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-end justify-between">
            <div>
              <h2 className="text-lg font-semibold flex items-center gap-2"><Crown className="h-5 w-5 text-amber-500" />Best finishes</h2>
              <p className="text-xs text-muted-foreground">Our highest placement per location across all stored seasons.</p>
            </div>
            <Link href="/assault/conquest" className="text-xs text-muted-foreground underline">All locations →</Link>
          </div>
          <div className="grid gap-2.5 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
            {standings.best_finishes.map(b => {
              const tone = b.position === 1 ? 'border-amber-500/70' : b.position === 2 ? 'border-slate-400/60' : b.position === 3 ? 'border-amber-700/60' : '';
              const label = b.position === 1 ? 'text-amber-500' : b.position === 2 ? 'text-slate-300' : b.position === 3 ? 'text-amber-600' : 'text-foreground';
              return (
                <Link key={b.zone_id} href={`/assault/conquest?season=${b.season_number}&zone=${b.zone_id}`}>
                  <div className={`group relative overflow-hidden rounded-xl border bg-card h-full hover:border-orange-500/60 transition ${tone}`}>
                    {b.image_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={b.image_url} alt="" className="absolute inset-0 h-full w-full object-cover opacity-25 group-hover:opacity-35 transition" loading="lazy" />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-card via-card/70 to-card/20" />
                    <div className="relative p-3 flex flex-col h-full min-h-[104px]">
                      <div className="text-xs font-medium truncate">{b.zone_name}</div>
                      <div className={`mt-auto text-3xl font-bold leading-none ${label}`}>
                        {ordinal(b.position)}<span className="text-xs font-normal text-muted-foreground"> /{b.of}</span>
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-1 flex justify-between">
                        <span>Season {b.season_number}</span>
                        <span className="tabular-nums">{compact(b.experience)} XP</span>
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {tools.map(t => (
          <Link key={t.href} href={t.href}>
            <Card className="h-full hover:border-orange-500/60 transition">
              <CardHeader className="p-4">
                <CardTitle className="flex items-center gap-2 text-sm"><t.icon className="h-4 w-4" />{t.title}</CardTitle>
                <CardDescription className="text-xs">{t.desc}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
