'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CalendarDays, Check, Copy, Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { copyToClipboard } from '@/lib/utils';
import type { CalendarEvent, CalendarKind } from '@/lib/calendar';

interface CalendarResponse {
  events: CalendarEvent[];
  my_guild_ids: string[];
  feed_url: string;
}

const KIND: Record<CalendarKind, { label: string; emoji: string; dot: string }> = {
  raid: { label: 'Raids', emoji: '⚔️', dot: 'bg-purple-500' },
  assault: { label: 'Assaults', emoji: '🛡️', dot: 'bg-red-500' },
  season: { label: 'Seasons', emoji: '🏁', dot: 'bg-amber-500' },
  event: { label: 'Events', emoji: '🎉', dot: 'bg-sky-500' },
  pool: { label: 'Pools', emoji: '💧', dot: 'bg-cyan-400' },
  giveaway: { label: 'Giveaways', emoji: '🎁', dot: 'bg-pink-500' },
  meeting: { label: 'Meetings', emoji: '🗣️', dot: 'bg-emerald-500' },
  other: { label: 'Other', emoji: '📌', dot: 'bg-gray-400' },
};

const localDayKey = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const dayHeading = (iso: string) => {
  const d = new Date(iso);
  const today = localDayKey(new Date().toISOString());
  const tomorrow = localDayKey(new Date(Date.now() + 86_400_000).toISOString());
  const key = localDayKey(iso);
  const date = d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
  return key === today ? `Today · ${date}` : key === tomorrow ? `Tomorrow · ${date}` : date;
};
const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

function relative(iso: string, now: number): string {
  const diff = Date.parse(iso) - now;
  if (diff <= 0) return 'now';
  const m = Math.round(diff / 60_000);
  if (m < 60) return `in ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `in ${h} h ${m % 60} min`;
  return `in ${Math.floor(h / 24)} d ${h % 24} h`;
}

/** Game day boundary: 11:50 UTC, shown in local time. */
function resetLocal(): string {
  const d = new Date();
  d.setUTCHours(11, 50, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export default function CalendarPage() {
  const { user, loading } = useAuth();
  const [data, setData] = useState<CalendarResponse | null>(null);
  const [error, setError] = useState<{ status: number; text: string } | null>(null);
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [hidden, setHidden] = useState<Set<CalendarKind>>(new Set());
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    document.title = 'Calendar · Dream Guilds';
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    fetch('/api/calendar?days=14', { cache: 'no-store' })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (!r.ok) setError({ status: r.status, text: j.error ?? 'Failed to load' });
        else {
          setData(j);
          if (!j.my_guild_ids?.length) setScope('all');
        }
      })
      .catch(() => !cancelled && setError({ status: 500, text: 'Failed to load' }));
    return () => {
      cancelled = true;
    };
  }, [user]);

  const mine = useMemo(() => new Set(data?.my_guild_ids ?? []), [data]);
  const scoped = useMemo(
    () =>
      (data?.events ?? []).filter(
        (e) => scope === 'all' || e.guild_ids.length === 0 || e.guild_ids.some((g) => mine.has(g))
      ),
    [data, scope, mine]
  );
  const kinds = useMemo(() => Array.from(new Set(scoped.map((e) => e.kind))), [scoped]);
  const visible = scoped.filter((e) => !hidden.has(e.kind));
  const upcoming = visible.filter((e) => !e.all_day && Date.parse(e.end ?? e.start) + (e.end ? 0 : 30 * 60_000) > now);
  const next = upcoming.find((e) => Date.parse(e.start) > now) ?? null;

  const days = useMemo(() => {
    const out = new Map<string, CalendarEvent[]>();
    for (const e of visible) {
      const k = e.all_day ? e.start.slice(0, 10) : localDayKey(e.start);
      const a = out.get(k) ?? [];
      a.push(e);
      out.set(k, a);
    }
    return Array.from(out.entries());
  }, [visible]);

  if (loading) return <Loader2 className="h-6 w-6 animate-spin mx-auto mt-16" />;
  if (!user) {
    return (
      <div className="max-w-xl mx-auto py-16 text-center space-y-3">
        <p>The calendar is for Dream Guilds members.</p>
        <Link href="/login?next=%2Fcalendar">
          <Button>Sign in</Button>
        </Link>
      </div>
    );
  }
  if (error) {
    return (
      <div className="max-w-xl mx-auto py-16 text-center space-y-3">
        <p className="text-red-500">{error.text}</p>
        {error.status === 403 && (
          <Link href="/account">
            <Button>Claim your character</Button>
          </Link>
        )}
      </div>
    );
  }
  if (!data) return <Loader2 className="h-6 w-6 animate-spin mx-auto mt-16" />;

  const toggle = (k: CalendarKind) =>
    setHidden((h) => {
      const n = new Set(h);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const copyFeed = async () => {
    if (await copyToClipboard(data.feed_url)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <CalendarDays className="h-6 w-6" /> Calendar
          </h1>
          <p className="text-muted-foreground text-sm">
            Raids, assaults and guild events for the next two weeks, in your local time. The game day resets at {resetLocal()}.
          </p>
        </div>
        <Tabs value={scope} onValueChange={(v) => setScope(v as 'mine' | 'all')}>
          <TabsList>
            <TabsTrigger value="mine" disabled={!mine.size}>
              My guilds
            </TabsTrigger>
            <TabsTrigger value="all">All guilds</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {next && (
        <Card className="overflow-hidden">
          <div className="bg-gradient-to-r from-crystal-deep/70 via-card to-background p-4 sm:p-5 flex flex-wrap items-center gap-3">
            <span className="text-3xl">{KIND[next.kind].emoji}</span>
            <div className="min-w-0 flex-1">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Next up</div>
              <div className="text-lg font-semibold">
                {next.title}
                {next.guild_tags.length > 0 && next.guild_tags.length <= 3 && (
                  <span className="text-muted-foreground font-normal"> · {next.guild_tags.join(', ')}</span>
                )}
              </div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold tabular-nums">{time(next.start)}</div>
              <div className="text-xs text-muted-foreground">{relative(next.start, now)}</div>
            </div>
          </div>
        </Card>
      )}

      {kinds.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {kinds.map((k) => (
            <button
              key={k}
              onClick={() => toggle(k)}
              className={`rounded-full border px-3 py-1 text-xs transition ${hidden.has(k) ? 'opacity-40' : 'bg-muted/40'}`}
            >
              {KIND[k].emoji} {KIND[k].label}
            </button>
          ))}
        </div>
      )}

      {days.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">Nothing scheduled.</CardContent>
        </Card>
      ) : (
        days.map(([key, events]) => (
          <Card key={key}>
            <CardHeader className="py-3">
              <CardTitle className="text-base">{dayHeading(events[0]!.all_day ? key + 'T12:00:00' : events[0]!.start)}</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <ul className="divide-y">
                {events.map((e) => {
                  const past = !e.all_day && Date.parse(e.end ?? e.start) + (e.end ? 0 : 30 * 60_000) <= now;
                  return (
                    <li key={e.id} className={`flex items-start gap-3 py-2.5 ${past ? 'opacity-50' : ''}`}>
                      <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${KIND[e.kind].dot}`} />
                      <div className="w-24 shrink-0 tabular-nums text-sm font-medium">
                        {e.all_day ? 'All day' : time(e.start)}
                        {e.end && <span className="text-muted-foreground"> – {time(e.end)}</span>}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">
                          {KIND[e.kind].emoji} {e.title}
                        </div>
                        {e.detail && <div className="text-xs text-muted-foreground">{e.detail}</div>}
                      </div>
                      <div className="flex flex-wrap justify-end gap-1 max-w-[40%]">
                        {e.guild_tags.length === 0 ? (
                          <Badge variant="outline" className="text-xs">All</Badge>
                        ) : (
                          e.guild_tags.map((t, i) => (
                            <Badge
                              key={t}
                              variant="outline"
                              className={`text-xs font-mono ${mine.has(e.guild_ids[i]!) ? 'border-sky-400/60 text-sky-300' : ''}`}
                            >
                              {t}
                            </Badge>
                          ))
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        ))
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">📅 Add it to your own calendar</CardTitle>
          <CardDescription>
            Your personal feed: network events plus your guilds, six weeks ahead. Google Calendar: Other calendars → + → From URL.
            Apple / Outlook: subscribe to a calendar by URL. Keep the link to yourself.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={copyFeed}>
            {copied ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
            {copied ? 'Copied' : 'Copy feed link'}
          </Button>
          <a href={data.feed_url.replace(/^https?:/, 'webcal:')}>
            <Button variant="outline" size="sm">Open in calendar app</Button>
          </a>
        </CardContent>
      </Card>
    </div>
  );
}
