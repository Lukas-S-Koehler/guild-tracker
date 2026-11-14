'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FlaskConical } from 'lucide-react';
import type { CombatPotion, Loadout, SlotKey, XpPotion } from '@/lib/potion-rules';
import { SLOT_LABELS, getSlotState, loadoutCost } from '@/lib/potion-rules';
import { QualityBadge } from './QualityBadge';

interface SavedLoadout extends Loadout {
  id: string;
  name: string;
  is_default: boolean;
}

const SLOT_ORDER: SlotKey[] = ['battle_xp', 'combat_xp', 'attack', 'protection'];

export function LoadoutChecklistBlock() {
  const [combat, setCombat] = useState<CombatPotion[]>([]);
  const [xp, setXp] = useState<XpPotion[]>([]);
  const [loadout, setLoadout] = useState<SavedLoadout | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [cRes, lRes] = await Promise.all([
          fetch('/api/assault/potions/catalog'),
          fetch('/api/assault/potions/loadouts'),
        ]);
        const cat = await cRes.json();
        const lo = await lRes.json();
        setCombat(cat.combat ?? []);
        setXp(cat.xp ?? []);
        const defaultLo = (lo.loadouts ?? []).find((l: SavedLoadout) => l.is_default) ?? (lo.loadouts ?? [])[0] ?? null;
        setLoadout(defaultLo);
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  if (!loaded) return null;

  if (!loadout) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2"><FlaskConical className="h-4 w-4" />Potion loadout</CardTitle>
          <CardDescription className="text-xs">No default loadout saved yet.</CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/assault/potions"><Button size="sm" variant="outline">Plan potions →</Button></Link>
        </CardContent>
      </Card>
    );
  }

  const state = getSlotState(loadout, combat, xp);
  const { tradeable, hasUnpriced } = loadoutCost(loadout, combat, xp);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center justify-between">
          <span className="flex items-center gap-2"><FlaskConical className="h-4 w-4" />{loadout.name}</span>
          <Link href="/assault/potions" className="text-xs font-normal text-primary hover:underline">Edit</Link>
        </CardTitle>
        <CardDescription className="text-xs">≈ {tradeable.toLocaleString()}g{hasUnpriced ? ' + free/unpriced' : ''}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {SLOT_ORDER.map((slot) => {
          const occ = state[slot];
          return (
            <div key={slot} className="flex items-center gap-2 text-sm">
              <span className="w-20 text-[11px] uppercase tracking-wide text-muted-foreground">{SLOT_LABELS[slot]}</span>
              {occ ? (
                <>
                  <span className="truncate">{occ.name}</span>
                  <QualityBadge quality={(occ as CombatPotion).quality ?? (occ as XpPotion).quality ?? null} />
                  <span className="text-xs text-muted-foreground ml-auto">
                    {occ.duration_minutes ? `${occ.duration_minutes}m restack` : '—'}
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground italic text-sm">empty</span>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
