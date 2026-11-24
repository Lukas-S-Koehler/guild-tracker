'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CalendarDays, Coins, Flame, History, Loader2, Map as MapIcon, Swords, Target, UserRound, Users } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import AchievementsCard from '@/components/me/AchievementsCard';
import RankingsCard from '@/components/me/RankingsCard';
import KudosCard from '@/components/profile/KudosCard';
import Heatmap from '@/components/me/Heatmap';
import type { Profile } from '@/lib/profile';

const fmt = (n: number) => n.toLocaleString('en-US');
const compact = (n: number) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(1)}k` : fmt(n);
const prettyDate = (d: string) =>
  new Date(d.length === 10 ? d + 'T12:00:00Z' : d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const title = (s: string | null) => (s ? s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ') : '');
const TONE_DOT = { good: 'bg-green-500', info: 'bg-sky-500' } as const;

function Avatar({ url, name, size = 'h-7 w-7' }: { url: string | null; name: string; size?: string }) {
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" className={`${size} rounded-full object-cover`} />
  ) : (
    <div className={`${size} rounded-full bg-muted flex items-center justify-center text-xs`}>{name.charAt(0)}</div>
  );
}

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

function Message({ children }: { children: React.ReactNode }) {
  return <div className="max-w-xl mx-auto py-16 text-center space-y-3">{children}</div>;
}

export default function ProfilePage() {
  const { ign } = useParams<{ ign: string }>();
  const { user, loading } = useAuth();
  const [data, setData] = useState<Profile | null>(null);
  const [error, setError] = useState<{ status: number; text: string } | null>(null);

  useEffect(() => {
    if (!user || !ign) return;
    let cancelled = false;
    setData(null);
    setError(null);
    fetch(`/api/profile/${ign}`, { cache: 'no-store' })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (!r.ok) setError({ status: r.status, text: j.error ?? 'Failed to load' });
        else setData(j);
      })
      .catch(() => !cancelled && setError({ status: 500, text: 'Failed to load' }));
    return () => {
      cancelled = true;
    };
  }, [user, ign]);

  useEffect(() => {
    if (data) document.title = `${data.ign} · Dream Guilds`;
  }, [data]);

  if (loading) return <Loader2 className="h-6 w-6 animate-spin mx-auto mt-16" />;
  if (!user) {
    return (
      <Message>
        <p>Profiles are for Dream Guilds members. Sign in to see this one.</p>
        <Link href={`/login?next=${encodeURIComponent(`/p/${ign}`)}`}><Button>Sign in</Button></Link>
      </Message>
    );
  }
  if (error) {
    return (
      <Message>
        <p className={error.status === 404 ? '' : 'text-red-500'}>{error.text}</p>
        {error.status === 403 && <Link href="/account"><Button>Claim your character</Button></Link>}
      </Message>
    );
  }
  if (!data) return <Loader2 className="h-6 w-6 animate-spin mx-auto mt-16" />;

  const { main, characters, tiles, achievements: ach } = data;
  const metPct = tiles.days_logged ? Math.round((tiles.days_met / tiles.days_logged) * 100) : 0;

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      {/* Hero */}
      <Card className="overflow-hidden">
        <div className="bg-gradient-to-r from-crystal-deep/70 via-card to-background p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-4">
            <Avatar url={main.avatar_url} name={main.ign} size="h-16 w-16 border-2 border-sky-400/60" />
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl sm:text-3xl font-bold text-white truncate">
                {main.ign}
                {ach.title && <span className="ml-2 text-base font-medium italic text-crystal-light">{ach.title.name}</span>}
              </h1>
              <div className="flex flex-wrap items-center gap-2 mt-1 text-sm text-sky-100/80">
                {main.combat_level != null && <span>CL {fmt(main.combat_level)} ·</span>}
                <span>Total level {fmt(main.total_level ?? 0)}</span>
                {main.class && <span>· {title(main.class)}</span>}
                {main.in_dream_guild ? (
                  <span>· {main.guild_name}{main.position ? ` (${title(main.position)})` : ''}</span>
                ) : (
                  <Badge variant="outline" className="border-muted-foreground/40 text-muted-foreground">Not in a Dream guild</Badge>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-2 text-xs text-sky-100/70">
                {ach.rank && (
                  <Badge variant="outline" className="border-crystal/60 text-crystal-light">
                    {ach.rank.emoji} {ach.rank.name}
                  </Badge>
                )}
                <span>{fmt(ach.xp)} Dream XP · {ach.unlocked} achievements</span>
                {characters.length > 1 && <span>· {characters.length} characters</span>}
                {!data.claimed && <span>· not claimed on the website yet</span>}
              </div>
            </div>
            {data.is_self && (
              <Link href="/me"><Button variant="outline" size="sm">This is you · My dashboard</Button></Link>
            )}
          </div>
        </div>
      </Card>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile icon={<Coins className="h-3.5 w-3.5" />} label="Lifetime gold" value={compact(tiles.lifetime_gold)} sub={`${compact(tiles.gold_30d)} last 30 days`} />
        <Tile icon={<Target className="h-3.5 w-3.5" />} label="Lifetime raids" value={fmt(tiles.lifetime_raids)} sub={`${fmt(tiles.raids_30d)} last 30 days`} />
        <Tile icon={<CalendarDays className="h-3.5 w-3.5" />} label="Days met" value={fmt(tiles.days_met)} sub={`${metPct}% of ${fmt(tiles.days_logged)} logged days`} />
        <Tile icon={<Swords className="h-3.5 w-3.5" />} label="Assault kills" value={compact(tiles.assault_kills)} sub={`${fmt(tiles.assault_runs)} waves · ${compact(tiles.assault_experience)} exp`} />
      </div>

      <AchievementsCard initial={ach} readOnly />

      <KudosCard ign={data.ign} initial={data.kudos} isSelf={data.is_self} accountIgns={characters.map((c) => c.ign)} />

      <RankingsCard src={`/api/profile/${ign}/rankings`} />

      <div className="grid md:grid-cols-3 gap-4">
        {/* Activity heatmap */}
        <Card className="md:col-span-2">
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

        {/* Streaks */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Flame className="h-4 w-4 text-orange-400" />
              Streak
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.streaks.length === 0 ? (
              <p className="text-sm text-muted-foreground">Not in an active Dream guild right now.</p>
            ) : (
              data.streaks.map((g) => (
                <div key={g.guild_name}>
                  {data.streaks.length > 1 && <div className="text-xs text-muted-foreground">{g.guild_nickname ?? g.guild_name}</div>}
                  <div className={`${data.streaks.length > 1 ? 'text-2xl' : 'text-4xl'} font-bold tabular-nums`}>
                    {g.current}
                    <span className="text-base font-normal text-muted-foreground"> {g.unit}{g.current === 1 ? '' : 's'}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">Best: {g.best} {g.unit}{g.best === 1 ? '' : 's'}</div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Feed: joins, assaults, achievements */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <History className="h-4 w-4 text-sky-400" />
              Recent highlights
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.feed.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing yet.</p>
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
          {/* Characters */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="h-4 w-4 text-sky-400" />
                Characters
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {characters.map((c) => (
                <div key={c.member_id} className="flex items-center gap-3 rounded-md px-2 py-1.5 text-sm">
                  <Avatar url={c.avatar_url} name={c.ign} />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">
                      {c.ign} {c.main && <span className="text-[10px] text-sky-400 ml-1">MAIN</span>}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {c.combat_level != null ? `CL ${c.combat_level} · ` : ''}Lv {fmt(c.total_level ?? 0)}
                      {c.class ? ` · ${title(c.class)}` : ''} · {c.in_dream_guild ? `${c.guild_nickname ?? c.guild_name}${c.position && c.position !== 'MEMBER' ? ` (${title(c.position)})` : ''}` : 'outside Dream'}
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Guild journey */}
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
                        {characters.length > 1 && <span className="text-muted-foreground font-normal">{j.ign} · </span>}
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

      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
        <UserRound className="h-3.5 w-3.5" />
        Profiles are members-only. Warnings, daily checks and holidays stay private.
      </p>
    </div>
  );
}
