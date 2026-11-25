'use client';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { CheckCircle2, CircleDashed, ShieldCheck, Sparkles } from 'lucide-react';
import type { RosterRow } from '@/lib/assault-roster';
import {
  IMPORTANCE_LABEL, TIERS, TIER_MEANING, TRACKS, evaluateGoals, meetsMinimum, nextStep, prerequisites,
  type GoalSet, type TrackDef, type TrackResult,
} from '@/lib/roster-goals';

/** Index 0 = not yet, 1..5 = Bronze..Dream. */
const TIER_STYLE = [
  'border-dashed text-muted-foreground',
  'border-amber-700/60 bg-amber-700/10 text-amber-600',
  'border-zinc-400/60 bg-zinc-400/10 text-zinc-300',
  'border-yellow-400/60 bg-yellow-400/10 text-yellow-400',
  'border-sky-400/60 bg-sky-400/10 text-sky-300',
  'border-crystal/70 bg-gradient-to-r from-crystal/25 to-fuchsia-500/20 text-crystal shadow-[0_0_10px_-3px] shadow-crystal/60',
];
const BAR_STYLE = ['bg-muted-foreground/30', 'bg-amber-700', 'bg-zinc-400', 'bg-yellow-400', 'bg-sky-400', 'bg-gradient-to-r from-crystal to-fuchsia-500'];
const TEXT_STYLE = ['text-muted-foreground', 'text-amber-600', 'text-zinc-300', 'text-yellow-400', 'text-sky-300', 'text-crystal'];
const IMPORTANCE_STYLE = { core: 'text-foreground', high: 'text-foreground/80', medium: 'text-muted-foreground', bonus: 'text-muted-foreground italic' };

export const tierName = (t: number) => (t === 0 ? 'Not yet' : TIERS[t - 1]);

export function TierChip({ tier, small }: { tier: number; small?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full border ${small ? 'px-1.5 text-[10px]' : 'px-2 py-0.5 text-xs'} font-medium whitespace-nowrap ${TIER_STYLE[tier]}`}
      title={tier ? TIER_MEANING[TIERS[tier - 1]] : 'Below the minimum'}
    >
      {tier === 5 && <Sparkles className="h-2.5 w-2.5" />}
      {tierName(tier)}
    </span>
  );
}

const defOf = (id: TrackResult['id']) => TRACKS.find((t) => t.id === id) as TrackDef;

function ProgressBar({ res }: { res: TrackResult }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
      <div className={`h-full ${BAR_STYLE[Math.min(5, res.tier + 1)]}`} style={{ width: `${Math.round((res.next == null ? 1 : res.progress) * 100)}%` }} />
    </div>
  );
}

function Prereqs({ r }: { r: RosterRow }) {
  const list = prerequisites(r);
  return (
    <div className="flex flex-wrap gap-1.5">
      {list.map((p) => (
        <span
          key={p.id}
          title={p.ok ? 'Set' : p.fix}
          className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] ${p.ok ? 'text-emerald-500 border-emerald-500/30' : 'text-amber-500 border-amber-500/40'}`}
        >
          {p.ok ? <CheckCircle2 className="h-3 w-3" /> : <CircleDashed className="h-3 w-3" />}
          {p.label}
        </span>
      ))}
    </div>
  );
}

/** Goals card inside the member drawer. */
export function GoalsSection({ r, goals }: { r: RosterRow; goals: GoalSet }) {
  const results = evaluateGoals(r, goals);
  const ok = meetsMinimum(r, results);
  const step = nextStep(results);
  const missing = prerequisites(r).find((p) => !p.ok);
  return (
    <section className="rounded-lg border p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold flex items-center gap-1.5"><Sparkles className="h-4 w-4" />Goals</h3>
        <span className={`text-xs flex items-center gap-1 ${ok ? 'text-emerald-500' : 'text-amber-500'}`}>
          <ShieldCheck className="h-3.5 w-3.5" />{ok ? 'Meets the minimum (Bronze)' : 'Below the minimum'}
        </span>
      </div>
      <div className="space-y-1">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Prerequisites</div>
        <Prereqs r={r} />
      </div>
      {missing ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-2.5 py-1.5 text-xs">
          <span className="text-muted-foreground">Next step · </span><b>{missing.label}</b>: {missing.fix}
        </div>
      ) : step && (
        <div className="rounded-md border border-crystal/30 bg-crystal/5 px-2.5 py-1.5 text-xs">
          <span className="text-muted-foreground">Next step · </span>
          <b>{defOf(step.id).label}</b> → <span className={TEXT_STYLE[step.tier + 1]}>{tierName(step.tier + 1)}</span>: {step.next}
        </div>
      )}
      {results.map((res) => {
        const def = defOf(res.id);
        return (
          <div key={res.id} className="space-y-1">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span title={def.hint}>
                <span className="font-medium">{def.label}</span>
                <span className={`ml-1.5 text-[10px] ${IMPORTANCE_STYLE[def.importance]}`}>{IMPORTANCE_LABEL[def.importance]}</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="text-muted-foreground">{res.current}</span>
                <TierChip tier={res.tier} small />
              </span>
            </div>
            <ProgressBar res={res} />
            <div className="text-[11px] text-muted-foreground">
              {!res.measured ? 'Set the prerequisites to get measured' : res.next ? <>Next <span className={TEXT_STYLE[res.tier + 1]}>{tierName(res.tier + 1)}</span>: {res.next}</> : <span className="text-crystal">Dream: perfect</span>}
            </div>
          </div>
        );
      })}
    </section>
  );
}

/** Goals view of the roster: tier ladder, team progress per element, everyone's tiers + next step. */
export function GoalsView({ rows, goals, onOpen }: { rows: RosterRow[]; goals: GoalSet; onOpen: (r: RosterRow) => void }) {
  const evaluated = rows.map((r) => {
    const results = evaluateGoals(r, goals);
    return { r, results, ok: meetsMinimum(r, results), step: nextStep(results), missing: prerequisites(r).find((p) => !p.ok) ?? null };
  });
  const n = rows.length || 1;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Team progress</CardTitle>
          <CardDescription>
            {TIERS.map((t, i) => (
              <span key={t} className="mr-3 whitespace-nowrap"><span className={TEXT_STYLE[i + 1]}>{t}</span> = {TIER_MEANING[t].toLowerCase()}</span>
            ))}
            <span className="block mt-1">
              <b className="text-foreground">{evaluated.filter((e) => e.ok).length}/{rows.length}</b> meet the minimum. Leaders set the tiers in Admin → Assault → Roster goals.
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {TRACKS.map((def) => {
            const counts = [0, 0, 0, 0, 0, 0];
            for (const e of evaluated) counts[e.results.find((x) => x.id === def.id)!.tier]++;
            return (
              <div key={def.id} className="space-y-1">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span title={def.hint}>
                    <span className="font-medium">{def.label}</span>
                    <span className={`ml-1.5 text-[10px] ${IMPORTANCE_STYLE[def.importance]}`}>{IMPORTANCE_LABEL[def.importance]}</span>
                  </span>
                  <span className="text-muted-foreground"><b className="text-foreground">{counts.slice(1).reduce((a, b) => a + b, 0)}</b>/{rows.length} at Bronze+</span>
                </div>
                <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
                  {counts.map((c, t) => (c ? <div key={t} className={BAR_STYLE[t]} style={{ width: `${(c / n) * 100}%` }} title={`${tierName(t)}: ${c}`} /> : null))}
                </div>
                <div className="flex gap-x-3 gap-y-0.5 flex-wrap text-[10px] text-muted-foreground">
                  {TIERS.map((t, i) => (
                    <span key={t}><span className={TEXT_STYLE[i + 1]}>{t}</span> {def.tierText(i, goals.tracks[def.id].thresholds, goals)} ({counts[i + 1]})</span>
                  ))}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Everyone&apos;s tiers</CardTitle>
          <CardDescription>Click a row for the breakdown. Next step = a missing minimum first, then the most important element that&apos;s closest.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto -mx-4 px-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b">
                  <th className="py-2 pr-3 font-medium">Character</th>
                  {TRACKS.map((t) => <th key={t.id} className="py-2 pr-2 font-medium whitespace-nowrap" title={t.hint}>{t.label}</th>)}
                  <th className="py-2 font-medium">Next step</th>
                </tr>
              </thead>
              <tbody>
                {evaluated.map(({ r, results, ok, step, missing }) => (
                  <tr key={r.member_id} className="border-b last:border-0 hover:bg-muted/40 cursor-pointer" onClick={() => onOpen(r)}>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      <span className="font-medium">{r.ign}</span>
                      <ShieldCheck className={`inline h-3.5 w-3.5 ml-1 ${ok ? 'text-emerald-500' : 'text-amber-500'}`} />
                      <div className="text-xs text-muted-foreground">CL {r.combat_level ?? '?'}</div>
                    </td>
                    {results.map((res) => (
                      <td key={res.id} className="py-2 pr-2 whitespace-nowrap" title={`${res.current}${res.next ? ` · next: ${res.next}` : ''}`}>
                        {res.measured ? <TierChip tier={res.tier} small /> : <span className="text-[10px] text-amber-500">set up</span>}
                      </td>
                    ))}
                    <td className="py-2 text-xs text-muted-foreground whitespace-nowrap">
                      {missing ? (
                        <span className="text-amber-500">Set up: {missing.label}</span>
                      ) : step ? (
                        <>{defOf(step.id).label} → <span className={TEXT_STYLE[step.tier + 1]}>{tierName(step.tier + 1)}</span></>
                      ) : (
                        <span className="text-crystal">All Dream</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
