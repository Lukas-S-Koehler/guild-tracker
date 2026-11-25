'use client';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ShieldCheck, Sparkles } from 'lucide-react';
import type { RosterRow } from '@/lib/assault-roster';
import { TIERS, TRACKS, evaluateGoals, hasRequirements, type GoalSet, type TrackDef, type TrackResult } from '@/lib/roster-goals';

/** Bronze / Silver / Gold / Crystal styling. Index 0 = no tier yet. */
const TIER_STYLE = [
  'border-dashed text-muted-foreground',
  'border-amber-700/60 bg-amber-700/10 text-amber-600',
  'border-zinc-400/60 bg-zinc-400/10 text-zinc-300',
  'border-yellow-400/60 bg-yellow-400/10 text-yellow-400',
  'border-crystal/60 bg-crystal/15 text-crystal',
];
const BAR_STYLE = ['bg-muted-foreground/30', 'bg-amber-700', 'bg-zinc-400', 'bg-yellow-400', 'bg-crystal'];

export const tierName = (t: number) => (t === 0 ? 'Not yet' : TIERS[t - 1]);

export function TierChip({ tier, small }: { tier: number; small?: boolean }) {
  return (
    <span className={`inline-flex items-center rounded-full border ${small ? 'px-1.5 text-[10px]' : 'px-2 py-0.5 text-xs'} font-medium whitespace-nowrap ${TIER_STYLE[tier]}`}>
      {tierName(tier)}
    </span>
  );
}

const defOf = (id: TrackResult['id']) => TRACKS.find((t) => t.id === id) as TrackDef;

/** "Bow → Silver: +10% hunt eff" — what to reach next on one track. */
export function nextStepText(res: TrackResult): string | null {
  if (res.next == null) return null;
  const def = defOf(res.id);
  if (res.value == null && res.id === 'hits') return 'Set your gear on /combat to get measured';
  return `${tierName(res.tier + 1)}: ${def.unit(res.next)}`;
}

/** The closest next tier across all tracks (most progress), for a motivating "next step". */
export function closestNextStep(results: TrackResult[]): TrackResult | null {
  const open = results.filter((r) => r.next != null && !(r.id === 'hits' && r.value == null));
  if (!open.length) return results.find((r) => r.id === 'hits' && r.value == null) ?? null;
  return open.sort((a, b) => b.progress - a.progress || a.tier - b.tier)[0];
}

function ProgressBar({ res }: { res: TrackResult }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
      <div className={`h-full ${BAR_STYLE[Math.min(4, res.tier + 1)]}`} style={{ width: `${Math.round((res.next == null ? 1 : res.progress) * 100)}%` }} />
    </div>
  );
}

const valueText = (res: TrackResult) => {
  if (res.value == null) return '—';
  if (res.id === 'hits') return `${res.value} hits`;
  if (res.id === 'bow') return res.value ? `+${res.value}%` : 'no bow';
  if (res.id === 'prep') return `${res.value}/3`;
  return res.value.toLocaleString();
};

/** Goals card inside the member drawer. */
export function GoalsSection({ r, goals }: { r: RosterRow; goals: GoalSet }) {
  const results = evaluateGoals(r, goals);
  const reqs = hasRequirements(goals);
  const meetsAll = results.every((x) => x.meetsRequired);
  return (
    <section className="rounded-lg border p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold flex items-center gap-1.5"><Sparkles className="h-4 w-4" />Goals</h3>
        {reqs && (
          <span className={`text-xs flex items-center gap-1 ${meetsAll ? 'text-emerald-500' : 'text-amber-500'}`}>
            <ShieldCheck className="h-3.5 w-3.5" />{meetsAll ? 'Meets the assault requirements' : 'Below the assault requirements'}
          </span>
        )}
      </div>
      {results.map((res) => {
        const def = defOf(res.id);
        const step = nextStepText(res);
        const req = goals[res.id].required;
        return (
          <div key={res.id} className="space-y-1">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-medium" title={def.hint}>{def.label}</span>
              <span className="flex items-center gap-1.5">
                <span className="tabular-nums text-muted-foreground">{valueText(res)}</span>
                <TierChip tier={res.tier} small />
              </span>
            </div>
            <ProgressBar res={res} />
            <div className="flex justify-between text-[11px] text-muted-foreground">
              <span>{step ? `Next ${step}` : 'Top tier reached'}</span>
              {req > 0 && <span className={res.meetsRequired ? 'text-emerald-500' : 'text-amber-500'}>required: {TIERS[req - 1]}</span>}
            </div>
          </div>
        );
      })}
    </section>
  );
}

/** Goals view of the roster: team progress per track + every member's tiers and next step. */
export function GoalsView({ rows, goals, onOpen }: { rows: RosterRow[]; goals: GoalSet; onOpen: (r: RosterRow) => void }) {
  const evaluated = rows.map((r) => ({ r, results: evaluateGoals(r, goals) }));
  const reqs = hasRequirements(goals);
  const n = rows.length || 1;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Team progress</CardTitle>
          <CardDescription>
            Long-term targets for everyone assaulting (auto and opt-in). Bronze → Silver → Gold → Crystal. Leaders set the tiers in Admin → Assault → Roster goals.
            {reqs ? ` ${evaluated.filter((e) => e.results.every((x) => x.meetsRequired)).length}/${rows.length} meet the assault requirements.` : ''}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {TRACKS.map((def) => {
            const counts = [0, 0, 0, 0, 0];
            for (const e of evaluated) counts[e.results.find((x) => x.id === def.id)!.tier]++;
            const maxTier = goals[def.id].thresholds.filter((t) => t != null).length;
            const goldPlus = counts.slice(3).reduce((a, b) => a + b, 0);
            return (
              <div key={def.id} className="space-y-1">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-medium" title={def.hint}>{def.label}</span>
                  <span className="text-muted-foreground">
                    {maxTier >= 3 ? <><b className="text-foreground">{goldPlus}</b>/{rows.length} Gold+</> : null}
                  </span>
                </div>
                <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
                  {counts.map((c, t) =>
                    c ? <div key={t} className={BAR_STYLE[t]} style={{ width: `${(c / n) * 100}%` }} title={`${tierName(t)}: ${c}`} /> : null
                  )}
                </div>
                <div className="flex gap-2 flex-wrap text-[10px] text-muted-foreground">
                  {goals[def.id].thresholds.map((t, i) =>
                    t == null ? null : (
                      <span key={i}>
                        <span className={TIER_STYLE[i + 1].split(' ').find((c) => c.startsWith('text-'))}>{TIERS[i]}</span> {def.unit(t)} ({counts[i + 1]})
                      </span>
                    )
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Everyone&apos;s tiers</CardTitle>
          <CardDescription>Click a row for the full breakdown. &quot;Next step&quot; is the closest tier to unlock.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto -mx-4 px-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b">
                  <th className="py-2 pr-3 font-medium">Character</th>
                  {TRACKS.map((t) => <th key={t.id} className="py-2 pr-3 font-medium" title={t.hint}>{t.label}</th>)}
                  <th className="py-2 font-medium">Next step</th>
                </tr>
              </thead>
              <tbody>
                {evaluated.map(({ r, results }) => {
                  const next = closestNextStep(results);
                  const ok = results.every((x) => x.meetsRequired);
                  return (
                    <tr key={r.member_id} className="border-b last:border-0 hover:bg-muted/40 cursor-pointer" onClick={() => onOpen(r)}>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        <span className="font-medium">{r.ign}</span>
                        {reqs && <ShieldCheck className={`inline h-3.5 w-3.5 ml-1 ${ok ? 'text-emerald-500' : 'text-amber-500'}`} />}
                        <div className="text-xs text-muted-foreground">CL {r.combat_level ?? '?'}</div>
                      </td>
                      {results.map((res) => (
                        <td key={res.id} className="py-2 pr-3 whitespace-nowrap" title={`${valueText(res)}${nextStepText(res) ? ` · next ${nextStepText(res)}` : ''}`}>
                          <TierChip tier={res.tier} small />
                        </td>
                      ))}
                      <td className="py-2 text-xs text-muted-foreground whitespace-nowrap">
                        {next ? <>{defOf(next.id).label} → {nextStepText(next)}</> : <span className="text-crystal">All tracks maxed</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
