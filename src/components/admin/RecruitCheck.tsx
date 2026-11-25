'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, MapPin, Search, Shield } from 'lucide-react';
import type { useApiClient } from '@/lib/api-client';
import type { EligibilityCharacter, GuildRubric } from '@/lib/assault-eligibility';
import type { MinGearPlan } from '@/lib/assault-roster';
import { GEAR_SLOTS } from '@/lib/combat/character-stats';
import { HUNTING_BOWS, bowBlocker } from '@/lib/combat/hunting-gear';
import { fmtGold } from '@/lib/roster-moves';
import { MinimumChecklist } from '@/components/assault/RosterGoals';

type Api = ReturnType<typeof useApiClient>;
interface CheckResult {
  character: EligibilityCharacter;
  rubrics: GuildRubric[];
  minGear: { guild_id: string; plan: MinGearPlan | null }[];
  usingMinGear: boolean;
}

const QUALITY_TEXT: Record<string, string> = { legendary: 'text-yellow-500', mythic: 'text-orange-500' };
const slotLabel = (k: string) => GEAR_SLOTS.find((s) => s.key === k)?.label ?? k;

/** The cheapest tier-1 gear set that gets every mob at the assault zone to 4 hits or fewer. */
function MinGearBox({ plan, ign }: { plan: MinGearPlan | null; ign: string }) {
  if (!plan) return null;
  return (
    <div className={`rounded-lg border p-3 space-y-2 ${plan.reachable ? 'border-crystal/40 bg-crystal/5' : 'border-amber-500/40 bg-amber-500/5'}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold flex items-center gap-1.5"><Shield className="h-4 w-4" />Minimum gear to join</p>
        {plan.items.length > 0 && <span className="text-sm text-yellow-400 tabular-nums">≈ {fmtGold(plan.total)}g</span>}
      </div>
      {plan.reachable && !plan.items.length && (
        <p className="text-sm text-emerald-500">No gear needed: {ign} already gets every mob to {plan.worstHits ?? '?'} hits or fewer.</p>
      )}
      {plan.items.length > 0 && (
        <ul className="space-y-1">
          {plan.items.map((i) => (
            <li key={i.slot} className="flex items-center justify-between gap-2 text-sm">
              <span>
                <span className="text-muted-foreground text-xs w-20 inline-block">{slotLabel(i.slot)}</span>
                <span className={QUALITY_TEXT[i.quality] ?? ''}>{i.name}</span>
                <span className="text-xs text-muted-foreground"> · T1 · CL {i.combat_level}</span>
              </span>
              <span className="text-xs tabular-nums text-muted-foreground">{i.price ? `${fmtGold(i.price)}g` : 'no recent sales'}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] text-muted-foreground">
        {plan.reachable
          ? `Worst mob with this set: ${plan.worstHits} hits (Bronze = 4 or fewer). Tier 1, recent market prices, with their best pet and the default potion preset. Anything stronger they already own works too.`
          : `Even with the best tier-1 gear we can price, the worst mob still takes ${plan.worstHits ?? '?'} hits. Battle can't reach Bronze yet here: they'd need upgraded tiers, more levels or a better pet.`}
      </p>
    </div>
  );
}

/**
 * Recruiter quick check: hashed id → the assault minimum checklist, measured with the cheapest gear
 * set that gets Battle to Bronze (the game doesn't share gear). Nothing is saved.
 */
export function RecruitCheckCard({ api }: { api: Api }) {
  const [input, setInput] = useState('');
  const [bow, setBow] = useState<string | null>(null);
  const [data, setData] = useState<CheckResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async (id: string, b: string | null) => {
    setBusy(true);
    setErr(null);
    const res = await api.post('/api/admin/recruit/check', { hashed_id: id, bow: b });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setErr(d.error ?? `Failed (${res.status})`);
    setData(d);
  };

  const c = data?.character;
  const guild = data?.rubrics[0];
  const res = c?.results.find((x) => x.guild.id === guild?.id);
  const plan = data?.minGear.find((m) => m.guild_id === guild?.id)?.plan ?? null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Quick check: could they join the assaults?</CardTitle>
        <CardDescription>
          Paste a player&apos;s hashed ID (they turn on &quot;Show hashed ID&quot; in the game settings). Shows the minimum gear they&apos;d need and the
          checklist with that gear on. Nothing is saved.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setBow(null);
            run(input.trim(), null);
          }}
        >
          <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Hashed ID" className="flex-1" />
          <Button type="submit" disabled={busy || !input.trim()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Search className="h-4 w-4 mr-1" />Check</>}
          </Button>
        </form>
        {err && <p className="text-sm text-destructive">{err}</p>}

        {c && guild && res && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              {c.image_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.image_url} alt="" className="h-10 w-10 rounded object-cover" />
              )}
              <div>
                <div className="font-semibold">{c.ign}</div>
                <div className="text-xs text-muted-foreground flex items-center gap-1 flex-wrap">
                  CL {c.combat_level ?? '?'} · {c.character_class ?? '?'} · {guild.name} at
                  <span className="inline-flex items-center gap-0.5"><MapPin className="h-3 w-3" />{guild.zoneName ?? 'its assault zone'}</span>
                </div>
              </div>
              <span className={`ml-auto rounded-md border px-2 py-1 text-xs font-medium ${res.verdict.meets ? 'border-emerald-500/50 text-emerald-500' : 'border-amber-500/50 text-amber-500'}`}>
                {res.verdict.meets ? 'Meets the minimum' : 'Not yet'}
              </span>
            </div>

            <MinGearBox plan={plan} ign={c.ign} />

            <MinimumChecklist
              key={`${c.hashed_id}:${bow ?? ''}`}
              r={res.row}
              goals={guild.goals}
              slots={{
                gear: <p className="text-xs text-muted-foreground">The game doesn&apos;t share gear: measured with the minimum gear above.</p>,
                bow: (
                  <select
                    className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                    value={bow ?? ''}
                    disabled={busy}
                    onChange={(e) => {
                      const b = e.target.value || null;
                      setBow(b);
                      run(c.hashed_id, b);
                    }}
                  >
                    <option value="">No hunting bow (ask them)</option>
                    {HUNTING_BOWS.map((bw) => {
                      const blocker = bowBlocker(bw, res.row.combat_level ?? 0, res.row.dexterity ?? 0);
                      return (
                        <option key={bw.name} value={bw.name}>
                          {bw.name} · +{bw.huntEff}%{blocker ? ` (${blocker})` : ''}
                        </option>
                      );
                    })}
                  </select>
                ),
              }}
            />
            {c.pets_hidden && (
              <p className="text-xs text-amber-500">Their pets are hidden in the game, so pet hunt power and battle pet can&apos;t be read. Ask them to unhide pets.</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
