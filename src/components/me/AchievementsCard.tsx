'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Award, ChevronDown, ChevronUp, Loader2, Lock } from 'lucide-react';
import { CATEGORIES, TIERS, type Category, type Tier } from '@/lib/achievements';
import type { AccountAchievements, AchievementView } from '@/lib/achievement-eval';

type Data = ({ claimed: true } & AccountAchievements) | { claimed: false };

const TIER_STYLE: Record<Tier, string> = {
  bronze: 'border-amber-700/60 bg-amber-900/20 text-amber-500',
  silver: 'border-slate-400/60 bg-slate-500/15 text-slate-200',
  gold: 'border-yellow-400/60 bg-yellow-500/15 text-yellow-300',
  crystal: 'border-crystal/70 bg-crystal/15 text-crystal-light',
  dream: 'border-fuchsia-400/70 bg-gradient-to-br from-fuchsia-500/25 via-crystal/20 to-indigo-500/25 text-fuchsia-200',
};
const BAR: Record<Tier, string> = {
  bronze: 'bg-amber-600',
  silver: 'bg-slate-300',
  gold: 'bg-yellow-400',
  crystal: 'bg-crystal',
  dream: 'bg-fuchsia-400',
};

const short = (n: number) => (n >= 1e6 ? `${+(n / 1e6).toFixed(2)}M` : n >= 1e4 ? `${+(n / 1e3).toFixed(1)}k` : n.toLocaleString('en-US'));
const prettyDate = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

function BadgeTile({ a }: { a: AchievementView }) {
  const got = !!a.unlocked_at;
  return (
    <div
      className={`rounded-md border p-2 text-xs ${got ? TIER_STYLE[a.tier] : 'border-border bg-muted/30 text-muted-foreground'}`}
      title={`${a.description}${got ? ` · unlocked ${prettyDate(a.unlocked_at!)}` : ''}`}
    >
      <div className="flex items-center gap-1 font-semibold truncate">
        {got ? <span>{TIERS[a.tier].emoji}</span> : <Lock className="h-3 w-3 shrink-0" />}
        <span className="truncate">{a.name}</span>
      </div>
      <p className="mt-0.5 line-clamp-2 opacity-80">{a.description}</p>
      {!got && !a.hidden && a.threshold > 1 && (
        <div className="mt-1.5 h-1 rounded bg-muted overflow-hidden">
          <div className={`h-full ${BAR[a.tier]}`} style={{ width: `${Math.round((a.value / a.threshold) * 100)}%` }} />
        </div>
      )}
    </div>
  );
}

/** Achievements for the whole account: count, Dream XP, title picker, next up, full catalogue. */
export default function AchievementsCard({ initial, readOnly = false }: { initial?: Data; readOnly?: boolean } = {}) {
  const [data, setData] = useState<Data | null>(initial ?? null);
  const [failed, setFailed] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (initial) return;
    let cancelled = false;
    fetch('/api/me/achievements', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: Data) => !cancelled && setData(d))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [initial]);

  const view = useMemo(() => {
    if (!data?.claimed) return null;
    const list = data.achievements;
    const unlocked = list.filter((a) => a.unlocked_at).sort((a, b) => (a.unlocked_at! < b.unlocked_at! ? 1 : -1));
    const next = list
      .filter((a) => !a.unlocked_at && !a.hidden && a.threshold > 1 && a.value > 0)
      .sort((a, b) => b.value / b.threshold - a.value / a.threshold)
      .slice(0, 3);
    const byCat = new Map<Category, AchievementView[]>();
    for (const a of list) byCat.set(a.category, [...(byCat.get(a.category) ?? []), a]);
    const titles = unlocked.filter((a) => a.title);
    return { unlocked, next, byCat, titles };
  }, [data]);

  if (failed || (data && !data.claimed)) return null;

  async function pickTitle(key: string) {
    if (!data?.claimed) return;
    setSaving(true);
    try {
      const r = await fetch('/api/me/achievements', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: key || null }),
      });
      const d = await r.json();
      if (r.ok) setData({ ...data, title: d.title });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex flex-wrap items-center gap-2">
          <Award className="h-4 w-4 text-crystal" />
          Achievements
          {data?.claimed && (
            <span className="text-sm font-normal text-muted-foreground">
              {data.unlocked} / {data.total} · {data.xp.toLocaleString('en-US')} Dream XP
              {data.rank && (
                <>
                  {' · '}
                  <span className="text-foreground font-medium">{data.rank.emoji} {data.rank.name}</span>
                </>
              )}
              {data.next_rank && (
                <span title={`${data.next_rank.emoji} ${data.next_rank.name} at ${data.next_rank.min} Dream XP`}>
                  {' · '}{(data.next_rank.min - data.xp).toLocaleString('en-US')} to {data.next_rank.name}
                </span>
              )}
            </span>
          )}
          {!readOnly && view && view.titles.length > 0 && data?.claimed && (
            <label className="ml-auto flex items-center gap-2 text-xs font-normal text-muted-foreground">
              Title
              <select
                className="h-7 rounded-md border bg-background px-2 text-xs text-foreground"
                value={data.title?.key ?? ''}
                disabled={saving}
                onChange={(e) => pickTitle(e.target.value)}
              >
                <option value="">None</option>
                {view.titles.map((a) => (
                  <option key={a.key} value={a.key}>
                    {TIERS[a.tier].emoji} {a.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!data || !view ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading achievements…
          </div>
        ) : (
          <>
            {view.unlocked.length === 0 ? (
              <p className="text-sm text-muted-foreground">No achievements yet. They are checked once a day after the activity check.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                {view.unlocked.slice(0, showAll ? 0 : 6).map((a) => (
                  <BadgeTile key={a.key} a={a} />
                ))}
              </div>
            )}

            {!readOnly && view.next.length > 0 && !showAll && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Next up</p>
                {view.next.map((a) => (
                  <div key={a.key} className="text-xs">
                    <div className="flex justify-between gap-2">
                      <span>
                        {TIERS[a.tier].emoji} <b>{a.name}</b> <span className="text-muted-foreground">· {a.description}</span>
                      </span>
                      <span className="text-muted-foreground whitespace-nowrap">
                        {short(a.value)} / {short(a.threshold)}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 rounded bg-muted overflow-hidden">
                      <div className={`h-full ${BAR[a.tier]}`} style={{ width: `${Math.round((a.value / a.threshold) * 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {showAll &&
              Array.from(view.byCat.entries()).map(([cat, list]) => (
                <div key={cat}>
                  <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                    {CATEGORIES[cat]} · {list.filter((a) => a.unlocked_at).length}/{list.length}
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                    {list.map((a) => (
                      <BadgeTile key={a.key} a={a} />
                    ))}
                  </div>
                </div>
              ))}

            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setShowAll((v) => !v)}>
              {showAll ? <ChevronUp className="h-3 w-3 mr-1" /> : <ChevronDown className="h-3 w-3 mr-1" />}
              {showAll ? 'Show less' : `Show all ${data.claimed ? data.total : ''}`}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
