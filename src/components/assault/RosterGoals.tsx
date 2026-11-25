'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import Link from 'next/link';
import { AlertTriangle, ChevronDown, ChevronRight, CircleDashed, Coins, Dumbbell, FlaskConical, Gift, Scale, ShieldCheck, Sparkles, Star, Wrench } from 'lucide-react';
import {
  BATTLE_PET_LADDER, EGG_RARITIES, QUALITY_BY_RANK, fmtGold, huntPlans, ownedForBattleStep, recommendBattle, recommendBow, recommendHunt, type Move,
} from '@/lib/roster-moves';
import type { RosterRow } from '@/lib/assault-roster';
import {
  IMPORTANCE_LABEL, TIERS, TIER_MEANING, TRACKS, belowMinimum, evaluateGoals, meetsMinimum, prerequisites, reminders,
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


/** Amber, non-blocking: e.g. no own potion loadout yet (measured on a provisional/Mid preset). */
export function Reminders({ r, showName }: { r: RosterRow; showName?: boolean }) {
  const list = reminders(r);
  if (!list.length) return null;
  return (
    <div className="space-y-1">
      {list.map((p) => (
        <div key={p.id} className="flex items-center justify-between gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-2.5 py-1.5 text-xs">
          <span className="flex items-center gap-1.5">
            <FlaskConical className="h-3.5 w-3.5 text-amber-500 shrink-0" />
            {showName ? <b>{r.ign}:</b> : null} <span className="text-muted-foreground">{p.fix}</span>
          </span>
          <Link href="/assault/potions" className="shrink-0 rounded border border-amber-500/50 px-2 py-0.5 text-amber-400 hover:bg-amber-500/10">Pick</Link>
        </div>
      ))}
    </div>
  );
}

/** One red block: setup (prerequisites) + eligibility (Bronze minimum). Green one-liner when all good. */
export function SetupEligibility({ r, goals, showName }: { r: RosterRow; goals: GoalSet; showName?: boolean }) {
  const results = evaluateGoals(r, goals);
  const missing = prerequisites(r).filter((p) => !p.ok);
  const below = belowMinimum(r, results).filter((x) => x.measured);
  if (!missing.length && !below.length) {
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-2.5 py-1.5 text-xs text-emerald-500">
          <ShieldCheck className="h-3.5 w-3.5" />{showName ? <b>{r.ign}</b> : null} Set up and eligible: meets the minimum (Bronze)
        </div>
        <Reminders r={r} />
      </div>
    );
  }
  const href = (id: string) => (id === 'gear' ? '/combat' : '/setup');
  return (
    <div className="rounded-md border border-red-500/50 bg-red-500/10 p-2.5 space-y-2">
      <div className="flex items-center gap-1.5 text-sm font-semibold text-red-400">
        <AlertTriangle className="h-4 w-4" />{showName ? `${r.ign}: ` : ''}Setup & eligibility
      </div>
      {missing.length > 0 && (
        <div className="space-y-1">
          {missing.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-2 text-xs">
              <span className="flex items-center gap-1.5"><CircleDashed className="h-3.5 w-3.5 text-red-400" />{p.label}: <span className="text-muted-foreground">{p.fix}</span></span>
              <Link href={href(p.id)} className="shrink-0 rounded border border-red-400/50 px-2 py-0.5 text-red-300 hover:bg-red-500/20">Fix</Link>
            </div>
          ))}
        </div>
      )}
      {below.length > 0 && (
        <div className="text-xs">
          <span className="text-red-300">Below the minimum:</span>{' '}
          {below.map((x, i) => (
            <span key={x.id}>{i ? ' · ' : ''}<b>{defOf(x.id).label}</b> needs {x.next}</span>
          ))}
        </div>
      )}
      {missing.length > 0 && <p className="text-[11px] text-muted-foreground">Until the setup is done some goals can&apos;t be measured.</p>}
      <Reminders r={r} />
    </div>
  );
}

const MOVE_ICON = { setup: Wrench, free: Gift, train: Dumbbell, buy: Coins };

/** In-game rarity colours (same as the roster). */
const RARITY_TEXT: Record<string, string> = {
  Standard: 'text-zinc-400', Refined: 'text-sky-500', Premium: 'text-green-500', Epic: 'text-red-500',
  Legendary: 'text-yellow-500', Mythic: 'text-orange-500',
};

/** Tier tabs from the next tier up to Dream: pick a jump target. */
function TargetTabs({ from, value, onChange }: { from: number; value: number; onChange: (t: number) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {TIERS.map((t, i) => i + 1).filter((t) => t > from).map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => onChange(t)}
          className={`rounded-md border px-2 py-0.5 text-[11px] ${value === t ? 'border-primary bg-primary/10' : 'text-muted-foreground hover:bg-muted'}`}
        >
          {tierName(t)}{t === from + 1 ? ' (next)' : ''}
        </button>
      ))}
    </div>
  );
}

/** Every egg against a pet hunt power target: strongest of the cheapest rarity that gets there is ★. */
function HuntWeigh({ r, goals, current }: { r: RosterRow; goals: GoalSet; current: number }) {
  const [target, setTarget] = useState(Math.min(5, current + 1));
  const ths = goals.tracks.pet_hunt.thresholds;
  const goal = ths[target - 1];
  const levelled = r.hunting.stableL100.reduce((a, b) => a + b, 0);
  const tierOf = (power: number) => ths.filter((t) => power >= t).length;
  // Only eggs that reach the target AND pull their weight there (user: the rest are useless).
  const plans = goal == null ? [] : huntPlans(r.hunting.stableL100, r.hunting.eggOptions, goal).filter((p) => p.reached && p.fits);
  const rec = recommendHunt(plans);
  const owned = r.hunting.stableL100.length;
  return (
    <div className="space-y-2 rounded-md border bg-muted/20 p-2">
      <TargetTabs from={current} value={target} onChange={setTarget} />
      <p className="text-[11px] text-muted-foreground">
        Target <b className="text-foreground">{tierName(target)}</b> = {goal?.toLocaleString()} pet hunt power. Your own {owned} best pets at L100 ≈{' '}
        <b className="text-foreground">{levelled.toLocaleString()}</b> <TierChip tier={tierOf(levelled)} small />
        {levelled >= (goal ?? Infinity) ? ' : levelling alone gets there.' : `. ${HUNT_STABLE_SIZE_TEXT(owned)}`}
      </p>
      {levelled < (goal ?? Infinity) && !plans.length && (
        <p className="text-[11px] text-amber-500">No egg gets you there on top of your own pets. Train pet mastery or aim one tier lower.</p>
      )}
      {levelled < (goal ?? Infinity) && plans.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-left text-muted-foreground border-b">
                <th className="py-1 pr-2 font-medium">Egg</th>
                <th className="py-1 pr-2 font-medium" title="Citadel est. encounters per hunt at L100 with your pet mastery">Enc / pet</th>
                <th className="py-1 pr-2 font-medium">Eggs</th>
                <th className="py-1 pr-2 font-medium">Gold</th>
                <th className="py-1 pr-2 font-medium">Result</th>
                <th className="py-1 font-medium" title="Egg price per encounter it hunts">Gold / enc</th>
              </tr>
            </thead>
            <tbody>
              {EGG_RARITIES.flatMap((q) => plans.filter((p) => p.quality === q)).map((p) => {
                const star = rec?.key === p.key;
                return (
                  <tr key={p.key} className={`border-b last:border-0 ${star ? 'bg-crystal/10' : ''}`}>
                    <td className="py-1 pr-2 whitespace-nowrap">
                      {star && <Star className="inline h-3 w-3 mr-0.5 text-crystal" />}
                      <span className={RARITY_TEXT[p.quality] ?? ''}>{p.label}</span>
                    </td>
                    <td className="py-1 pr-2 tabular-nums">{p.enc}</td>
                    <td className="py-1 pr-2 tabular-nums">{p.n ?? '—'}</td>
                    <td className="py-1 pr-2 tabular-nums whitespace-nowrap">
                      {p.cost != null ? <span className="text-yellow-400">{fmtGold(p.cost)}g</span> : p.price ? '—' : <span className="text-muted-foreground">no price</span>}
                      {p.note && p.cost != null && <span className="text-muted-foreground"> est.</span>}
                    </td>
                    <td className="py-1 pr-2 whitespace-nowrap">≈{p.power.toLocaleString()} <TierChip tier={tierOf(p.power)} small /></td>
                    <td className="py-1 tabular-nums">{p.perEnc != null ? fmtGold(p.perEnc) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[10px] text-muted-foreground">
        ★ = strongest egg of the cheapest rarity whose pets fit the target (≥ {Math.ceil((goal ?? 0) / 20)} encounters each): pets hunt for months, so strength beats a little gold. Eggs are counted at L100 on top of your own pets levelled to L100. Citadel estimates.
      </p>
    </div>
  );
}
const HUNT_STABLE_SIZE_TEXT = (owned: number) => (owned < 20 ? `${20 - owned} of the 20 counted slots are empty, so every egg adds its full value.` : 'New eggs replace your weakest counted pets.');

/** One square per mob coloured by hits (same look as the Lineup hits column). */
const HIT_SQ: Record<number, string> = { 1: 'bg-emerald-500 text-white', 2: 'bg-emerald-500 text-white', 3: 'bg-lime-500 text-black', 4: 'bg-amber-500 text-black' };
function HitSquares({ hits }: { hits: (number | null)[] }) {
  return (
    <span className="inline-flex gap-0.5">
      {hits.map((h, i) => (
        <span key={i} className={`h-4 w-4 rounded text-[10px] font-bold tabular-nums flex items-center justify-center ${h == null ? 'bg-muted text-muted-foreground' : HIT_SQ[h] ?? 'bg-red-500 text-white'}`}>
          {h ?? '–'}
        </span>
      ))}
    </span>
  );
}

/** Every battle species of the target tier's rarity, simulated here at L100. */
function BattleWeigh({ r, current }: { r: RosterRow; current: number }) {
  const [target, setTarget] = useState(Math.min(5, current + 1));
  const step = BATTLE_PET_LADDER[target - 1];
  const quality = QUALITY_BY_RANK[step[0]];
  const owned = ownedForBattleStep(r, step);
  const options = r.battle.speciesOptions.filter((o) => o.quality === quality);
  const rec = recommendBattle(r, quality);
  const now = r.battle.computed ? 1 : null;
  return (
    <div className="space-y-2 rounded-md border bg-muted/20 p-2">
      <TargetTabs from={current} value={target} onChange={setTarget} />
      <p className="text-[11px] text-muted-foreground">
        <b className="text-foreground">{tierName(target)}</b> needs a <span className={RARITY_TEXT[quality]}>{quality}</span> at L{step[1]}{step[2] ? ` evo ${step[2]}` : ''}.
        {owned ? <> You own <b className="text-foreground">{owned.species}</b> (L{owned.level}{owned.evolution ? ` evo ${owned.evolution}` : ''}): levelling it is free.</> : null}
        {now != null && r.battle.bestPet ? <> Now ({r.battle.bestPet.species} L{r.battle.bestPet.level}): <HitSquares hits={r.battle.enemies.map((e) => e.hits)} />{r.battle.max2HitLevel && r.battle.canScale && !r.battle.scaleFixed ? ` 2 hits to Lv ${r.battle.max2HitLevel}` : ''}</> : null}
      </p>
      {options.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-left text-muted-foreground border-b">
                <th className="py-1 pr-2 font-medium">Pet (L100)</th>
                <th className="py-1 pr-2 font-medium" title="Hits to kill each mob here at its own level, one square per mob">Hits</th>
                {options.some((o) => o.twoHitLv != null) && <th className="py-1 pr-2 font-medium" title="Highest scaled level where every mob still dies in 2 hits (CL 100+)">2 hits to</th>}
                <th className="py-1 pr-2 font-medium" title="Damage per hit, summed over the mobs here">Damage</th>
                <th className="py-1 pr-2 font-medium" title="Damage taken per kill, summed (defence saves food)">Dmg taken</th>
                <th className="py-1 font-medium">Egg</th>
              </tr>
            </thead>
            <tbody>
              {options.map((o) => {
                const star = rec?.label === o.label;
                return (
                  <tr key={o.label} className={`border-b last:border-0 ${star ? 'bg-crystal/10' : o.price ? '' : 'opacity-45'}`}>
                    <td className="py-1 pr-2 whitespace-nowrap">
                      {star && <Star className="inline h-3 w-3 mr-0.5 text-crystal" />}
                      <span className={RARITY_TEXT[o.quality] ?? ''}>{o.label}</span>
                    </td>
                    <td className="py-1 pr-2 whitespace-nowrap"><HitSquares hits={o.perMob} /></td>
                    {options.some((x) => x.twoHitLv != null) && <td className="py-1 pr-2 tabular-nums">{o.twoHitLv != null ? `Lv ${o.twoHitLv}` : '—'}</td>}
                    <td className="py-1 pr-2 tabular-nums font-medium">{Math.round(o.dmg).toLocaleString()}</td>
                    <td className="py-1 pr-2 tabular-nums">{o.taken.toLocaleString()}</td>
                    <td className="py-1 tabular-nums whitespace-nowrap">
                      {o.price ? <span className="text-yellow-400">{fmtGold(o.price)}g</span> : <span className="text-muted-foreground">no price</span>}
                      {o.note && o.price ? <span className="text-muted-foreground"> est.</span> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">Set gear on /combat to simulate pets here.</p>
      )}
      <p className="text-[10px] text-muted-foreground">
        ★ = strongest for battling here: fewest hits, then highest 2-hit scaling (CL 100+), then most damage, then least damage taken. Hits are at each mob&apos;s own level. Simulated with your gear, loadout and pet mastery. The main suggestion goes at most one rarity above your best pet; pick a higher tab to plan a jump.
      </p>
    </div>
  );
}

/** Every hunting bow that reaches a hunt efficiency target, with requirements and price. */
function BowWeigh({ r, goals, current }: { r: RosterRow; goals: GoalSet; current: number }) {
  const [target, setTarget] = useState(Math.min(5, current + 1));
  const ths = goals.tracks.bow.thresholds;
  const need = ths[target - 1];
  const tierOf = (eff: number) => ths.filter((t) => eff >= t).length;
  // Only bows that reach the target (user: weaker ones are useless here). Strongest first.
  const list = r.hunting.bowOptions.filter((o) => o.huntEff >= need).sort((a, b) => b.huntEff - a.huntEff || (a.price ?? Infinity) - (b.price ?? Infinity));
  const rec = recommendBow(r.hunting.bowOptions, need);
  return (
    <div className="space-y-2 rounded-md border bg-muted/20 p-2">
      <TargetTabs from={current} value={target} onChange={setTarget} />
      <p className="text-[11px] text-muted-foreground">
        <b className="text-foreground">{tierName(target)}</b> needs +{need}% hunt efficiency. Now: {r.hunting.bow ? `${r.hunting.bow.name} +${r.hunting.bow.huntEff}%` : 'no hunting bow'}.
        You: CL {r.combat_level ?? '?'} · DEX {r.dexterity ?? '?'}.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-left text-muted-foreground border-b">
              <th className="py-1 pr-2 font-medium">Bow</th>
              <th className="py-1 pr-2 font-medium">Hunt eff</th>
              <th className="py-1 pr-2 font-medium">Requires</th>
              <th className="py-1 pr-2 font-medium">Price</th>
              <th className="py-1 font-medium">Tier</th>
            </tr>
          </thead>
          <tbody>
            {list.map((o) => {
              const star = rec?.name === o.name;
              return (
                <tr key={o.name} className={`border-b last:border-0 ${star ? 'bg-crystal/10' : ''}`}>
                  <td className="py-1 pr-2 whitespace-nowrap">
                    {star && <Star className="inline h-3 w-3 mr-0.5 text-crystal" />}
                    <span className={RARITY_TEXT[o.quality] ?? ''}>{o.name}</span>
                    {r.hunting.bow?.name === o.name && <span className="ml-1 text-[10px] text-muted-foreground">(yours)</span>}
                  </td>
                  <td className="py-1 pr-2 tabular-nums font-medium">+{o.huntEff}%</td>
                  <td className={`py-1 pr-2 whitespace-nowrap tabular-nums ${o.blocker ? 'text-amber-500' : 'text-muted-foreground'}`} title={o.blocker ?? 'You can equip it'}>
                    CL {o.combatLevel} / DEX {o.dexterity}{o.blocker ? ' ✗' : ' ✓'}
                  </td>
                  <td className="py-1 pr-2 tabular-nums whitespace-nowrap">{o.price ? <span className="text-yellow-400">{fmtGold(o.price)}g</span> : <span className="text-muted-foreground">no price</span>}</td>
                  <td className="py-1"><TierChip tier={tierOf(o.huntEff)} small /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-muted-foreground">
        ★ = strongest bow you can equip in the cheapest rarity that reaches the target (you keep it a long time). Hunt efficiency is fixed: upgrading a bow&apos;s tier doesn&apos;t change it. Bows matter less once your pets hunt well.
      </p>
    </div>
  );
}

/** Next best moves list (drawer). Pet and bow moves can open the weigh-options view. */
export function MovesList({ r, goals }: { r: RosterRow; goals: GoalSet }) {
  const [open, setOpen] = useState<string | null>(null);
  const list = r.moves.filter((m) => m.kind !== 'setup');
  if (!list.length) return null;
  const results = evaluateGoals(r, goals);
  const tierOfTrack = (id: string) => results.find((x) => x.id === id)?.tier ?? 0;
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Next best moves</div>
      {list.slice(0, 5).map((m, i) => {
        const Icon = MOVE_ICON[m.kind];
        const label = m.track === 'setup' ? 'Setup' : m.track === 'class' ? 'Class' : defOf(m.track).label;
        const key = `${m.track}:${i}`;
        return (
          <div key={i} className="space-y-1">
            <div className={`flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-xs ${i === 0 ? 'border-crystal/40 bg-crystal/5' : ''}`}>
              <Icon className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div>
                  <b>{m.title}</b>
                  {m.toTier > 0 && <> <span className="text-muted-foreground">→ {label}</span> <TierChip tier={m.toTier} small /></>}
                </div>
                {m.detail && <div className="text-[11px] text-muted-foreground">{m.detail}</div>}
                {m.weigh && (
                  <button type="button" className="mt-0.5 inline-flex items-center gap-0.5 text-[11px] text-crystal hover:underline" onClick={() => setOpen(open === key ? null : key)}>
                    {open === key ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                    <Scale className="h-3 w-3" />Weigh options
                  </button>
                )}
              </div>
              <div className="shrink-0 text-right">
                {m.cost != null ? (
                  <span className="font-semibold tabular-nums text-yellow-400">{fmtGold(m.cost)}g</span>
                ) : (
                  <span className="text-[11px] text-muted-foreground">{m.kind === 'train' ? 'training' : 'no gold'}</span>
                )}
                {m.costNote && <div className="text-[10px] text-muted-foreground">{m.costNote}</div>}
              </div>
            </div>
            {open === key && m.weigh === 'pet_hunt' && <HuntWeigh r={r} goals={goals} current={tierOfTrack('pet_hunt')} />}
            {open === key && m.weigh === 'battle_pet' && <BattleWeigh r={r} current={tierOfTrack('battle_pet')} />}
            {open === key && m.weigh === 'bow' && <BowWeigh r={r} goals={goals} current={tierOfTrack('bow')} />}
          </div>
        );
      })}
      <p className="text-[10px] text-muted-foreground">Prices are recent market sales (gear at base tier). Ranked by importance, then cost.</p>
    </div>
  );
}

/** Goals card inside the member drawer. */
export function GoalsSection({ r, goals }: { r: RosterRow; goals: GoalSet }) {
  const results = evaluateGoals(r, goals);
  const [weigh, setWeigh] = useState<string | null>(null);
  return (
    <section className="rounded-lg border p-3 space-y-3">
      <h3 className="text-sm font-semibold flex items-center gap-1.5"><Sparkles className="h-4 w-4" />Goals</h3>
      <SetupEligibility r={r} goals={goals} />
      <MovesList r={r} goals={goals} />
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
            <div className="text-[11px] text-muted-foreground flex items-center justify-between gap-2">
              <span>
                {!res.measured ? 'Set the prerequisites to get measured' : res.next ? <>Next <span className={TEXT_STYLE[res.tier + 1]}>{tierName(res.tier + 1)}</span>: {res.next}</> : <span className="text-crystal">Dream: perfect</span>}
              </span>
              {(res.id === 'pet_hunt' || res.id === 'battle_pet' || res.id === 'bow') && res.measured && res.tier < 5 && (
                <button type="button" className="shrink-0 inline-flex items-center gap-0.5 text-crystal hover:underline" onClick={() => setWeigh(weigh === res.id ? null : res.id)}>
                  <Scale className="h-3 w-3" />{weigh === res.id ? 'Hide options' : 'Weigh options'}
                </button>
              )}
            </div>
            {weigh === 'pet_hunt' && res.id === 'pet_hunt' && <HuntWeigh r={r} goals={goals} current={res.tier} />}
            {weigh === 'battle_pet' && res.id === 'battle_pet' && <BattleWeigh r={r} current={res.tier} />}
            {weigh === 'bow' && res.id === 'bow' && <BowWeigh r={r} goals={goals} current={res.tier} />}
          </div>
        );
      })}
    </section>
  );
}

/** Goals view of the roster: tier ladder, team progress per element, everyone's tiers + next step. */
export function GoalsView({ rows, goals, mine = [], onOpen }: { rows: RosterRow[]; goals: GoalSet; mine?: string[]; onOpen: (r: RosterRow) => void }) {
  const evaluated = rows.map((r) => {
    const results = evaluateGoals(r, goals);
    return { r, results, ok: meetsMinimum(r, results), move: r.moves[0] ?? null };
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
          <CardDescription>Click a row for the breakdown. Next best move = setup first, then a missing minimum, then importance and cost.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto -mx-4 px-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b">
                  <th className="py-2 pl-2 pr-3 font-medium">Character</th>
                  {TRACKS.map((t) => <th key={t.id} className="py-2 pr-2 font-medium whitespace-nowrap" title={t.hint}>{t.label}</th>)}
                  <th className="py-2 font-medium">Next step</th>
                </tr>
              </thead>
              <tbody>
                {evaluated.map(({ r, results, ok, move }) => (
                  <tr key={r.member_id} className={`border-b last:border-0 cursor-pointer ${mine.includes(r.member_id) ? 'bg-primary/10 shadow-[inset_3px_0_0_0] shadow-primary hover:bg-primary/15' : 'hover:bg-muted/40'}`} onClick={() => onOpen(r)}>
                    <td className="py-2 pl-2 pr-3 whitespace-nowrap">
                      <span className="font-medium">{r.ign}</span>
                      {mine.includes(r.member_id) && <span className="ml-1"><span className="rounded bg-primary/20 px-1 text-[10px] font-medium text-primary">you</span></span>}
                      <ShieldCheck className={`inline h-3.5 w-3.5 ml-1 ${ok ? 'text-emerald-500' : 'text-amber-500'}`} />
                      <div className="text-xs text-muted-foreground">CL {r.combat_level ?? '?'}</div>
                    </td>
                    {results.map((res) => (
                      <td key={res.id} className="py-2 pr-2 whitespace-nowrap" title={`${res.current}${res.next ? ` · next: ${res.next}` : ''}`}>
                        {res.measured ? <TierChip tier={res.tier} small /> : <span className="text-[10px] text-amber-500">set up</span>}
                      </td>
                    ))}
                    <td className="py-2 text-xs text-muted-foreground whitespace-nowrap">
                      {move?.kind === 'setup' ? (
                        <span className="rounded border border-red-500/50 bg-red-500/10 px-1.5 py-0.5 text-red-400">Set up: {move.title}</span>
                      ) : move ? (
                        <span title={move.detail}>
                          {move.title}
                          {move.cost != null && <span className="text-yellow-400"> · {fmtGold(move.cost)}g</span>}
                          {move.toTier > 0 && <span className={TEXT_STYLE[move.toTier]}> → {tierName(move.toTier)}</span>}
                        </span>
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
