'use client';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { CombatPotion, XpPotion } from '@/lib/potion-rules';
import { loadoutCost, RECOMMENDED_PRESET_ID } from '@/lib/potion-rules';
import type { Preset } from '@/lib/potions-service';
import { TierChip } from '@/components/assault/RosterGoals';

interface Props {
  preset: Preset;
  combat: CombatPotion[];
  xp: XpPotion[];
  onLoad: () => void;
}

const TIER_ACCENTS: Record<string, string> = {
  free: 'border-emerald-500/50',
  budget: 'border-sky-500/50',
  silver: 'border-zinc-400/50',
  gold: 'border-yellow-400/50',
  mid: 'border-amber-500/50',
  whale: 'border-rose-500/50',
};

export function PresetTierCard({ preset, combat, xp, onLoad }: Props) {
  const { tradeable, hasUnpriced } = loadoutCost(
    { combat_potion_ids: preset.combat_potion_ids, xp_potion_ids: preset.xp_potion_ids },
    combat,
    xp,
  );
  const combatById = new Map(combat.map((p) => [p.id, p]));
  const xpById = new Map(xp.map((p) => [p.id, p]));
  const recommended = preset.id === RECOMMENDED_PRESET_ID;
  const names = [
    ...preset.combat_potion_ids.map((id) => combatById.get(id)?.name).filter(Boolean),
    ...preset.xp_potion_ids.map((id) => xpById.get(id)?.name).filter(Boolean),
  ];

  return (
    <Card className={`border ${TIER_ACCENTS[preset.id] ?? 'border-border'}${recommended ? ' ring-2 ring-amber-500/60' : ''}`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          {preset.label}
          {!!preset.assault_tier && (
            <span title="Assault tier on the roster goals"><TierChip tier={preset.assault_tier} small /></span>
          )}
          {recommended && (
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-500">
              ⭐ Recommended
            </span>
          )}
        </CardTitle>
        {preset.description && <CardDescription className="text-xs">{preset.description}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-2">
        <ul className="text-xs space-y-0.5">
          {names.map((n, i) => (<li key={i} className="truncate">· {n}</li>))}
        </ul>
        <div className="text-xs text-muted-foreground">
          ≈ {tradeable.toLocaleString()}g{hasUnpriced ? ' + free/unpriced' : ''}
        </div>
        {preset.id === 'free' && (
          <div className="text-[11px] text-emerald-500/70 italic">
            Got a Potion of the Gods? Drop it in the Battle XP slot.
          </div>
        )}
        <Button size="sm" variant={recommended ? 'default' : 'outline'} className="w-full" onClick={onLoad}>Load into sandbox</Button>
      </CardContent>
    </Card>
  );
}
