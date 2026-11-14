'use client';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { CombatPotion, XpPotion } from '@/lib/potion-rules';
import { loadoutCost } from '@/lib/potion-rules';
import type { Preset } from '@/lib/potions-service';

interface Props {
  preset: Preset;
  combat: CombatPotion[];
  xp: XpPotion[];
  onLoad: () => void;
}

const TIER_ACCENTS: Record<string, string> = {
  free: 'border-emerald-500/50',
  budget: 'border-sky-500/50',
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
  const names = [
    ...preset.combat_potion_ids.map((id) => combatById.get(id)?.name).filter(Boolean),
    ...preset.xp_potion_ids.map((id) => xpById.get(id)?.name).filter(Boolean),
  ];

  return (
    <Card className={`border ${TIER_ACCENTS[preset.id] ?? 'border-border'}`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{preset.label}</CardTitle>
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
        <Button size="sm" variant="outline" className="w-full" onClick={onLoad}>Load into sandbox</Button>
      </CardContent>
    </Card>
  );
}
