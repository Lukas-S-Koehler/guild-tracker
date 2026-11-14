'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { CombatPotion, Loadout, SlotKey, XpPotion } from '@/lib/potion-rules';
import { SLOT_LABELS, getSlotState, loadoutCost, violations } from '@/lib/potion-rules';
import { QualityBadge } from './QualityBadge';
import { Trash2 } from 'lucide-react';

interface Props {
  loadout: Loadout;
  combat: CombatPotion[];
  xp: XpPotion[];
  onRemoveCombat: (id: number) => void;
  onRemoveXp: (id: number) => void;
}

const SLOT_ORDER: SlotKey[] = ['battle_xp', 'combat_xp', 'attack', 'protection'];

export function LoadoutSummary({ loadout, combat, xp, onRemoveCombat, onRemoveXp }: Props) {
  const state = getSlotState(loadout, combat, xp);
  const { tradeable, hasUnpriced } = loadoutCost(loadout, combat, xp);
  const vs = violations(loadout, combat, xp);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center justify-between">
          <span>Current Loadout</span>
          <span className="text-sm font-normal text-muted-foreground">
            ≈ {tradeable.toLocaleString()}g{hasUnpriced ? ' + unpriced' : ''}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {SLOT_ORDER.map((slot) => {
          const occupant = state[slot];
          return (
            <div key={slot} className="flex items-center gap-3 border rounded px-3 py-2">
              <div className="w-24 text-xs uppercase tracking-wide text-muted-foreground">{SLOT_LABELS[slot]}</div>
              {occupant ? (
                <>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="truncate">{occupant.name}</span>
                      <QualityBadge quality={(occupant as CombatPotion).quality ?? (occupant as XpPotion).quality ?? null} />
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {occupant.duration_minutes ? `${occupant.duration_minutes}m` : '—'}
                      {occupant.market_price ? ` · ${occupant.market_price.toLocaleString()}g` : ''}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if ('attack_power_bonus' in occupant) onRemoveCombat(occupant.id);
                      else onRemoveXp(occupant.id);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </>
              ) : (
                <div className="flex-1 text-sm text-muted-foreground italic">empty</div>
              )}
            </div>
          );
        })}
        {vs.length > 0 && (
          <div className="text-xs text-destructive space-y-0.5 pt-1">
            {vs.map((v) => (<div key={v.slot}>⚠ {v.message}</div>))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
