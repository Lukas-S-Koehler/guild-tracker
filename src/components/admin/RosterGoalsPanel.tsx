'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2 } from 'lucide-react';
import { IMPORTANCE_LABEL, TIERS, TIER_MEANING, TRACKS, type GoalSet, type TrackId } from '@/lib/roster-goals';
import { TierChip } from '@/components/assault/RosterGoals';

interface GuildRef { id: string; name: string; nickname: string | null }

/** Admin → Assault → Roster goals: leaders set tier thresholds and requirements per assault guild. */
export default function RosterGoalsPanel() {
  const [guilds, setGuilds] = useState<GuildRef[] | null>(null);
  const [guildId, setGuildId] = useState<string | null>(null);
  const [goals, setGoals] = useState<GoalSet | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/assault/roster', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        const list: GuildRef[] = d.guilds ?? [];
        setGuilds(list);
        if (list[0]) setGuildId(list[0].id);
      })
      .catch(() => setGuilds([]));
  }, []);

  const load = useCallback(async (gid: string) => {
    setGoals(null);
    setMsg(null);
    const res = await fetch(`/api/assault/roster/goals?guild=${gid}`, { cache: 'no-store' });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return setMsg({ ok: false, text: d.error ?? 'Failed to load' });
    setGoals(d.goals);
  }, []);
  useEffect(() => { if (guildId) load(guildId); }, [guildId, load]);

  const setThreshold = (track: TrackId, i: number, v: string) =>
    setGoals((g) => {
      if (!g) return g;
      const ths = [...g.tracks[track].thresholds];
      ths[i] = Number(v);
      return { ...g, tracks: { ...g.tracks, [track]: { thresholds: ths } } };
    });
  const setScale = (k: 'crystalScale' | 'dreamScale', v: string) => setGoals((g) => (g ? { ...g, battle: { ...g.battle, [k]: Number(v) } } : g));

  const save = async (reset = false) => {
    if (!guildId || !goals) return;
    setBusy(true);
    setMsg(null);
    const res = await fetch('/api/assault/roster/goals', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reset ? { guild_id: guildId, reset: true } : { guild_id: guildId, goals }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMsg({ ok: false, text: d.error ?? 'Failed' });
    setGoals(d.goals);
    setMsg({ ok: true, text: reset ? 'Back to the defaults.' : 'Saved. The roster uses these right away.' });
  };

  if (!guilds) return <Loader2 className="h-5 w-5 animate-spin" />;
  if (!guilds.length) return <p className="text-sm text-muted-foreground">No assault guild you can manage.</p>;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Roster goals</CardTitle>
        <CardDescription>
          Tiers for the Goals view on /assault/roster, per assault guild. Bronze = minimum requirement, Silver = cost-effective,
          Gold = upper half, Crystal = the top, Dream = absolutely perfect.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {guilds.length > 1 && (
          <div className="flex gap-2">
            {guilds.map((g) => (
              <Button key={g.id} size="sm" variant={g.id === guildId ? 'default' : 'outline'} onClick={() => setGuildId(g.id)}>
                {g.nickname ?? g.name}
              </Button>
            ))}
          </div>
        )}
        {msg && <p className={`text-sm ${msg.ok ? 'text-emerald-500' : 'text-red-500'}`}>{msg.text}</p>}
        {goals && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b">
                    <th className="py-2 pr-3 font-medium">Element</th>
                    {TIERS.map((t, i) => (
                      <th key={t} className="py-2 pr-2 font-medium" title={TIER_MEANING[t]}><TierChip tier={i + 1} small /></th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {TRACKS.map((def) => (
                    <tr key={def.id} className="border-b last:border-0 align-top">
                      <td className="py-2 pr-3">
                        <div className="font-medium">{def.label} <span className="text-[10px] font-normal text-muted-foreground">{IMPORTANCE_LABEL[def.importance]}</span></div>
                        <div className="text-[11px] text-muted-foreground max-w-[16rem]">{def.hint}</div>
                      </td>
                      {TIERS.map((t, i) => {
                        const editable = def.editable && !(def.id === 'slayer' && i === 0);
                        const scaleKey = def.id === 'battle' ? (i === 3 ? 'crystalScale' : i === 4 ? 'dreamScale' : null) : null;
                        return (
                          <td key={t} className="py-2 pr-2 text-[11px] text-muted-foreground">
                            {editable ? (
                              <Input
                                className="h-8 w-20 tabular-nums"
                                inputMode="numeric"
                                value={goals.tracks[def.id].thresholds[i]}
                                onChange={(e) => setThreshold(def.id, i, e.target.value)}
                              />
                            ) : scaleKey ? (
                              <div className="space-y-1">
                                <div>all 2 hits scaled to Lv</div>
                                <Input className="h-8 w-20 tabular-nums" inputMode="numeric" value={goals.battle[scaleKey]} onChange={(e) => setScale(scaleKey, e.target.value)} />
                              </div>
                            ) : (
                              def.tierText(i, goals.tracks[def.id].thresholds, goals)
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Bronze is the minimum requirement. Potion tiers come from the potion presets (each preset has an assault tier). Prerequisites (gear, potion loadout, visible pets) aren&apos;t tiers.
            </p>
            <div className="flex gap-2">
              <Button disabled={busy} onClick={() => save(false)}>{busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Save</Button>
              <Button variant="outline" disabled={busy} onClick={() => save(true)}>Reset to defaults</Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
