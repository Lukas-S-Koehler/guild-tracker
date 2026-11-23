'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  ArrowLeft, CheckSquare, Clock, Crown, FlaskConical, Loader2, Map as MapIcon, Medal, Pin, Star, Swords, Waves, Zap,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import type { MeAssault, WaveRow, AssaultRank } from '@/lib/me-assault';
import { TERRITORY_BOOSTS } from '@/lib/assault-plan-static';
import { ASSAULT_TOP_MIN_CL } from '@/lib/raids';

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const compact = (n: number) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(1)}k` : fmt(n);
const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function countdown(unix: number, now: number) {
  const s = Math.max(0, Math.floor(unix - now / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m ${String(s % 60).padStart(2, '0')}s`;
}

function Tile({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-4 space-y-1">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">{icon}{label}</div>
        <div className="text-2xl font-bold tabular-nums">{value}</div>
        {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

const rankText = (r: AssaultRank | null) => (r ? `#${r.rank}` : '—');
const rankSub = (r: AssaultRank | null, empty: string) => (r ? `of ${fmt(r.of)} Dream players · ${compact(r.experience)} exp` : empty);

function MeAssaultInner() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const seasonParam = params.get('season');
  const [data, setData] = useState<MeAssault | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showAllWaves, setShowAllWaves] = useState(false);
  const now = useNow();

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setBusy(true);
    setError(null);
    fetch(`/api/me/assault${seasonParam ? `?season=${encodeURIComponent(seasonParam)}` : ''}`, { cache: 'no-store' })
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
  }, [user, seasonParam]);

  if (loading || (user && !data && !error)) return <Loader2 className="h-6 w-6 animate-spin mx-auto mt-16" />;
  if (!user) {
    return (
      <div className="max-w-xl mx-auto py-16 text-center space-y-3">
        <p>Sign in to see your assault season.</p>
        <Link href="/login?next=/me/assault"><Button>Sign in</Button></Link>
      </div>
    );
  }
  if (error) return <p className="text-center text-red-500 mt-16">{error}</p>;
  if (!data) return null;
  if (!data.claimed) {
    return (
      <div className="max-w-xl mx-auto py-16 text-center space-y-3">
        <p>Claim your IdleMMO character to see your assault season.</p>
        <Link href="/account"><Button>Claim character</Button></Link>
      </div>
    );
  }

  const { totals, attendance, ranks, zones, waves, best_wave, guilds, loadout } = data;
  const pickSeason = (s: number) => router.push(s === data.current_season ? '/me/assault' : `/me/assault?season=${s}`);
  const shownWaves = showAllWaves ? waves : waves.slice(0, 12);
  const nothing = zones.length === 0 && waves.every((w) => !w.attended);
  const attendancePct = attendance.waves ? Math.round((attendance.attended / attendance.waves) * 100) : null;

  return (
    <div className={`max-w-6xl mx-auto space-y-4 ${busy ? 'opacity-70 transition-opacity' : ''}`}>
      {/* Header + season picker */}
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/me" className="text-muted-foreground hover:text-foreground" aria-label="Back to my dashboard"><ArrowLeft className="h-5 w-5" /></Link>
        <Swords className="h-6 w-6 text-orange-500" />
        <h1 className="text-2xl font-bold">My assault</h1>
        <Badge variant="outline" className={data.finished ? 'border-violet-500/50 text-violet-300' : 'border-orange-500/50 text-orange-300'}>
          Season {data.season}{data.finished ? ' · recap' : ' · live'}
        </Badge>
        <div className="flex flex-wrap gap-1 ml-auto">
          {data.seasons.map((s) => (
            <button
              key={s}
              onClick={() => pickSeason(s)}
              className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${s === data.season ? 'bg-crystal/20 border-crystal/60 text-crystal-light' : 'border-border hover:bg-muted'}`}
            >
              S{s}{s === data.current_season ? ' (now)' : ''}
            </button>
          ))}
        </div>
      </div>

      {data.finished && (
        <Card className="border-violet-500/30 bg-violet-500/5">
          <CardContent className="p-4 text-sm flex flex-wrap items-center gap-2">
            <Crown className="h-4 w-4 text-violet-300" />
            <span>
              Season {data.season} is over. This is your recap. Share it on Discord with{' '}
              <code className="text-xs bg-muted px-1 rounded">/assault me season:{data.season} share:True</code>
            </span>
          </CardContent>
        </Card>
      )}

      {/* Next launch + checklist (current season only) */}
      {!data.finished && guilds.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {guilds.map((g) => {
            const pct = g.checklist && g.checklist.total ? Math.round((g.checklist.done / g.checklist.total) * 100) : 0;
            return (
              <Card key={g.guild_id}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-orange-400" />
                    <span className="font-semibold">{g.nickname ?? g.name}</span>
                    {g.zone_name && <span className="text-xs text-muted-foreground">· {g.zone_name}</span>}
                    {!g.active && <Badge variant="outline" className="ml-auto text-xs">paused</Badge>}
                  </div>
                  {g.next_launch_unix ? (
                    <div>
                      <p className="text-xs text-muted-foreground">Next launch {new Date(g.next_launch_unix * 1000).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</p>
                      <p className="text-2xl font-bold tabular-nums">{countdown(g.next_launch_unix, now)}</p>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No launch scheduled{g.season_end ? ` (season ended ${g.season_end})` : ''}.</p>
                  )}
                  {g.checklist && g.checklist.total > 0 && (
                    <Link href="/assault/checklist" className="block space-y-1 group">
                      <div className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1.5 text-muted-foreground group-hover:text-foreground"><CheckSquare className="h-3.5 w-3.5" />Checklist</span>
                        <span className="tabular-nums">{g.checklist.done} / {g.checklist.total}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className={`h-full ${pct === 100 ? 'bg-green-500' : 'bg-orange-500'}`} style={{ width: `${pct}%` }} />
                      </div>
                    </Link>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {nothing && (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground space-y-2 text-center">
            <p>No assault contributions in season {data.season}{data.finished ? '' : ' yet'}.</p>
            {guilds.length === 0 && !data.finished && (
              <p>
                Want to fight? <Link href="/guilds/DE" className="underline">Dream Engineers</Link> is open to every level (casual assaults),{' '}
                <Link href="/guilds/DI" className="underline">Dream Invaders</Link> runs hardcore assaults from CL {ASSAULT_TOP_MIN_CL}.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Tiles */}
      {!nothing && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Tile icon={<Zap className="h-3.5 w-3.5" />} label="Season EXP" value={compact(totals.experience)} sub={`${totals.characters} character${totals.characters === 1 ? '' : 's'} · ${totals.zones} zone${totals.zones === 1 ? '' : 's'}`} />
          <Tile icon={<Swords className="h-3.5 w-3.5" />} label="Kills" value={compact(totals.kills)} sub={totals.experience ? `${fmt(totals.experience / Math.max(totals.kills, 1))} exp per kill` : undefined} />
          <Tile icon={<Waves className="h-3.5 w-3.5" />} label="Waves" value={attendance.waves ? `${attendance.attended} / ${attendance.waves}` : '—'} sub={attendancePct != null ? `${attendancePct}% since your first wave` : 'No finished waves yet'} />
          <Tile icon={<Medal className="h-3.5 w-3.5" />} label="Season rank" value={rankText(ranks.season)} sub={rankSub(ranks.season, 'Not ranked yet')} />
          <Tile icon={<Crown className="h-3.5 w-3.5" />} label="All-time rank" value={rankText(ranks.all_time)} sub={rankSub(ranks.all_time, 'Not ranked yet')} />
        </div>
      )}

      {/* Zones */}
      {zones.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <MapIcon className="h-4 w-4 text-crystal" />
              Season contribution by zone
              <span className="text-xs font-normal text-muted-foreground">· ranks inside your guild and among Dream players</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {zones.map((z) => {
              const boost = z.guild_position && z.guild_position <= 10 ? TERRITORY_BOOSTS[z.guild_position - 1] : null;
              return (
                <div key={`${z.zone_id}-${z.guild_external_id}`} className="rounded-md border overflow-hidden">
                  <div className="flex flex-wrap items-center gap-3 p-3 bg-muted/30">
                    {z.image_url && <img src={z.image_url} alt="" className="h-10 w-10 rounded object-cover" />}
                    <div className="min-w-0">
                      <p className="font-semibold truncate">{z.zone_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {z.guild_name}
                        {z.guild_position ? ` · guild ${ordinal(z.guild_position)} of ${z.guild_of}` : ''}
                      </p>
                    </div>
                    {boost && (
                      <Badge variant="outline" className="border-green-500/50 text-green-300 text-xs">
                        Top 10: +{boost.expMf}% EXP/MF, +{boost.eff}% eff{data.finished ? ' next season' : ' if it holds'}
                      </Badge>
                    )}
                    <div className="ml-auto text-right">
                      <p className="font-bold tabular-nums">{compact(z.experience)} exp</p>
                      <p className="text-xs text-muted-foreground tabular-nums">{fmt(z.kills)} kills</p>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-xs text-muted-foreground">
                        <tr className="border-t">
                          <th className="text-left font-normal px-3 py-1.5">Character</th>
                          <th className="text-right font-normal px-3 py-1.5">EXP</th>
                          <th className="text-right font-normal px-3 py-1.5">Kills</th>
                          <th className="text-right font-normal px-3 py-1.5" title="Your place among your guild's members in this zone">Guild (EXP / kills)</th>
                          <th className="text-right font-normal px-3 py-1.5" title="Your place among every Dream player in this zone">Dream</th>
                        </tr>
                      </thead>
                      <tbody>
                        {z.characters.map((c) => (
                          <tr key={c.ign} className="border-t">
                            <td className="px-3 py-1.5">{c.ign}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{fmt(c.experience)}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{fmt(c.kills)}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">
                              <span className={c.guild_rank_xp <= 3 ? 'text-crystal-light font-semibold' : ''}>#{c.guild_rank_xp}</span>
                              {' / '}#{c.guild_rank_kills}
                              <span className="text-muted-foreground"> of {c.guild_size}</span>
                            </td>
                            <td className="px-3 py-1.5 text-right tabular-nums">
                              #{c.dream_rank_xp}<span className="text-muted-foreground"> of {c.dream_of}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
            <p className="text-xs text-muted-foreground">
              Shard rewards rank every player in the zone, including other guilds we can&apos;t see, so there&apos;s no shard estimate here.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        {/* Waves */}
        <Card className="md:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Waves className="h-4 w-4 text-sky-400" />
              Waves
              <span className="text-xs font-normal text-muted-foreground">· newest first, from your first wave this season</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {best_wave && (
              <div className="mb-3 rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 text-sm flex flex-wrap items-center gap-2">
                <Star className="h-4 w-4 text-yellow-400" />
                <span>
                  Best wave: <b>{best_wave.guild_name} wave {best_wave.wave}</b> on {best_wave.zone_name}, {when(best_wave.starts_at)} ·{' '}
                  {compact(best_wave.experience)} exp · {best_wave.share_pct}% of the guild
                  {best_wave.rank ? ` · ${ordinal(best_wave.rank)} of ${best_wave.participants}` : ''}
                </span>
              </div>
            )}
            {waves.length === 0 ? (
              <p className="text-sm text-muted-foreground">No waves recorded{data.finished ? '' : ' yet this season'}.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground">
                    <tr>
                      <th className="text-left font-normal py-1.5 pr-3">Wave</th>
                      <th className="text-left font-normal py-1.5 pr-3">When</th>
                      <th className="text-right font-normal py-1.5 pr-3">EXP</th>
                      <th className="text-right font-normal py-1.5 pr-3">Kills</th>
                      <th className="text-right font-normal py-1.5 pr-3">Share</th>
                      <th className="text-right font-normal py-1.5">Place</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shownWaves.map((w: WaveRow) => (
                      <tr key={w.run_id} className={`border-t ${w.attended ? '' : 'text-muted-foreground'}`}>
                        <td className="py-1.5 pr-3 whitespace-nowrap">
                          {w.guild_name} · W{w.wave}
                          <span className="text-xs text-muted-foreground"> {w.zone_name}</span>
                        </td>
                        <td className="py-1.5 pr-3 whitespace-nowrap text-xs">{when(w.starts_at)}{w.status !== 'finalized' && <Badge variant="outline" className="ml-1 text-[10px]">live</Badge>}</td>
                        {w.attended ? (
                          <>
                            <td className="py-1.5 pr-3 text-right tabular-nums">{compact(w.experience)}</td>
                            <td className="py-1.5 pr-3 text-right tabular-nums">{fmt(w.kills)}</td>
                            <td className="py-1.5 pr-3 text-right tabular-nums">{w.share_pct}%</td>
                            <td className="py-1.5 text-right tabular-nums">{w.rank ? `${ordinal(w.rank)} / ${w.participants}` : '—'}</td>
                          </>
                        ) : (
                          <td colSpan={4} className="py-1.5 text-right text-xs">missed</td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {waves.length > 12 && (
                  <button className="text-xs text-muted-foreground hover:text-foreground mt-2" onClick={() => setShowAllWaves((v) => !v)}>
                    {showAllWaves ? 'Show fewer' : `Show all ${waves.length} waves`}
                  </button>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Pinned loadout */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Pin className="h-4 w-4 text-crystal" />
              My loadout
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="font-medium flex items-center gap-1.5"><FlaskConical className="h-3.5 w-3.5 text-muted-foreground" />Potions</p>
                <Link href="/assault/potions" className="text-xs text-muted-foreground hover:text-foreground">Edit →</Link>
              </div>
              {loadout.potions ? (
                <div className="space-y-1.5">
                  <p className="text-xs text-muted-foreground">Default loadout: {loadout.potions.name}</p>
                  {[...loadout.potions.combat, ...loadout.potions.xp].map((p) => (
                    <div key={p.name} className="flex items-center gap-2">
                      {p.image_url ? <img src={p.image_url} alt="" className="h-5 w-5" /> : <span className="h-5 w-5" />}
                      <span>{p.name}</span>
                    </div>
                  ))}
                  {!loadout.potions.combat.length && !loadout.potions.xp.length && <p className="text-xs text-muted-foreground">Empty loadout.</p>}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No default loadout. Save one on the potions page (or with <code>/assault loadout</code>) and mark it default.</p>
              )}
            </div>
            <div className="space-y-2 border-t pt-3">
              <div className="flex items-center justify-between">
                <p className="font-medium flex items-center gap-1.5"><Swords className="h-3.5 w-3.5 text-muted-foreground" />Combat setup</p>
                <Link href={loadout.setup ? `/combat?setup=${loadout.setup.id}` : '/combat'} className="text-xs text-muted-foreground hover:text-foreground">
                  {loadout.setup ? 'Open →' : 'Combat tool →'}
                </Link>
              </div>
              {loadout.setup ? (
                <div className="space-y-0.5">
                  <p className="font-semibold">{loadout.setup.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {[loadout.setup.ign, loadout.setup.enemy_name && `${loadout.setup.enemy_name}${loadout.setup.zone_name ? ` @ ${loadout.setup.zone_name}` : ''}`, loadout.setup.pet, loadout.setup.gear_mode === 'sandbox' ? 'sandbox gear' : 'my gear']
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Nothing pinned. In the combat tool, press the pin on a saved setup.</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {guilds.length === 0 && !nothing && !data.finished && (
        <p className="text-xs text-muted-foreground text-center">
          None of your characters is in an assault guild right now.{' '}
          <Link href="/guilds/DE" className="underline">Find one</Link> (Dream Engineers is open to every level).
        </p>
      )}
    </div>
  );
}

export default function MeAssaultPage() {
  return (
    <Suspense fallback={<Loader2 className="h-6 w-6 animate-spin mx-auto mt-16" />}>
      <MeAssaultInner />
    </Suspense>
  );
}
