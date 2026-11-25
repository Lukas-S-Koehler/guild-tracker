'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2 } from 'lucide-react';
import { TIERS, TRACKS, type GoalSet } from '@/lib/roster-goals';
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

  const setThreshold = (track: keyof GoalSet, i: number, v: string) =>
    setGoals((g) => {
      if (!g) return g;
      const ths = [...g[track].thresholds];
      ths[i] = v.trim() === '' ? null : Number(v);
      return { ...g, [track]: { ...g[track], thresholds: ths } };
    });
  const setRequired = (track: keyof GoalSet, v: number) =>
    setGoals((g) => (g ? { ...g, [track]: { ...g[track], required: v } } : g));

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
          Tier thresholds for the Goals view on /assault/roster, per assault guild. Keep them motivating: Bronze should be reachable for most,
          Crystal is the long-term target. &quot;Required&quot; turns a tier into an assault requirement (shown on the roster, nothing is enforced yet).
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
                    <th className="py-2 pr-3 font-medium">Track</th>
                    {TIERS.map((t, i) => <th key={t} className="py-2 pr-2 font-medium"><TierChip tier={i + 1} small /></th>)}
                    <th className="py-2 font-medium">Required</th>
                  </tr>
                </thead>
                <tbody>
                  {TRACKS.map((def) => (
                    <tr key={def.id} className="border-b last:border-0 align-top">
                      <td className="py-2 pr-3">
                        <div className="font-medium">{def.label}</div>
                        <div className="text-[11px] text-muted-foreground max-w-[16rem]">{def.hint}{def.lowerIsBetter ? ' Lower = harder.' : ''}</div>
                      </td>
                      {goals[def.id].thresholds.map((v, i) => (
                        <td key={i} className="py-2 pr-2">
                          <Input
                            className="h-8 w-20 tabular-nums"
                            inputMode="numeric"
                            value={v ?? ''}
                            placeholder="—"
                            onChange={(e) => setThreshold(def.id, i, e.target.value)}
                          />
                        </td>
                      ))}
                      <td className="py-2">
                        <select
                          className="h-8 rounded-md border bg-background px-2 text-xs"
                          value={goals[def.id].required}
                          onChange={(e) => setRequired(def.id, Number(e.target.value))}
                        >
                          <option value={0}>None</option>
                          {TIERS.map((t, i) => goals[def.id].thresholds[i] != null && <option key={t} value={i + 1}>{t}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
