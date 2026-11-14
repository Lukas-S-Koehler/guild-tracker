'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, FlaskConical, Loader2, Save, Star } from 'lucide-react';
import type { CombatPotion, Loadout, XpPotion } from '@/lib/potion-rules';
import { canAddCombatPotion, canAddXpPotion, getSlotState } from '@/lib/potion-rules';
import type { Preset } from '@/lib/potions-service';
import { PotionCard } from '@/components/assault/PotionCard';
import { LoadoutSummary } from '@/components/assault/LoadoutSummary';
import { PresetTierCard } from '@/components/assault/PresetTierCard';
import { useAuth } from '@/contexts/AuthContext';

interface Props {
  combat: CombatPotion[];
  xp: XpPotion[];
  presets: Preset[];
}

interface SavedLoadout extends Loadout {
  id: string;
  name: string;
  is_default: boolean;
}

const EMPTY: Loadout = { combat_potion_ids: [], xp_potion_ids: [] };

export function PotionsClient({ combat, xp, presets }: Props) {
  const { user } = useAuth();
  const [loadout, setLoadout] = useState<Loadout>(EMPTY);
  const [name, setName] = useState('My loadout');
  const [isDefault, setIsDefault] = useState(true);
  const [saved, setSaved] = useState<SavedLoadout[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const refresh = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const res = await fetch('/api/assault/potions/loadouts');
      const json = await res.json();
      setSaved(json.loadouts ?? []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user]);

  const state = useMemo(() => getSlotState(loadout, combat, xp), [loadout, combat, xp]);

  const addCombat = (p: CombatPotion) => {
    const check = canAddCombatPotion(p, state);
    if (!check.ok) return;
    setLoadout((l) => ({ ...l, combat_potion_ids: [...l.combat_potion_ids, p.id] }));
  };
  const addXp = (p: XpPotion) => {
    const check = canAddXpPotion(p, state);
    if (!check.ok) return;
    setLoadout((l) => ({ ...l, xp_potion_ids: [...l.xp_potion_ids, p.id] }));
  };
  const removeCombat = (id: number) => setLoadout((l) => ({ ...l, combat_potion_ids: l.combat_potion_ids.filter((x) => x !== id) }));
  const removeXp = (id: number) => setLoadout((l) => ({ ...l, xp_potion_ids: l.xp_potion_ids.filter((x) => x !== id) }));

  const loadPreset = (p: Preset) => {
    setLoadout({ combat_potion_ids: [...p.combat_potion_ids], xp_potion_ids: [...p.xp_potion_ids] });
    setName(`${p.label} loadout`);
    setEditingId(null);
  };

  const loadSaved = (s: SavedLoadout) => {
    setLoadout({ combat_potion_ids: [...s.combat_potion_ids], xp_potion_ids: [...s.xp_potion_ids] });
    setName(s.name);
    setIsDefault(s.is_default);
    setEditingId(s.id);
  };

  const save = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const res = await fetch('/api/assault/potions/loadouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingId ?? undefined,
          name,
          is_default: isDefault,
          combat_potion_ids: loadout.combat_potion_ids,
          xp_potion_ids: loadout.xp_potion_ids,
        }),
      });
      if (res.ok) {
        const json = await res.json();
        setEditingId(json.loadout?.id ?? null);
        await refresh();
      }
    } finally {
      setSaving(false);
    }
  };

  const del = async (id: string) => {
    if (!confirm('Delete loadout?')) return;
    await fetch(`/api/assault/potions/loadouts?id=${id}`, { method: 'DELETE' });
    if (editingId === id) { setEditingId(null); setLoadout(EMPTY); }
    await refresh();
  };

  const combatSelected = new Set(loadout.combat_potion_ids);
  const xpSelected = new Set(loadout.xp_potion_ids);

  const xpByCategory = (cat: 'battle_xp' | 'combat_xp') => xp.filter((p) => p.category === cat);

  const combatSorted = useMemo(() => {
    return [...combat].sort((a, b) => {
      const totalA = a.attack_power_bonus + a.protection_bonus;
      const totalB = b.attack_power_bonus + b.protection_bonus;
      return totalB - totalA;
    });
  }, [combat]);

  const bestValueId = useMemo(() => {
    // Lowest gold-per-stat among tradeable priced
    let best: { id: number; ratio: number } | null = null;
    for (const p of combat) {
      if (!p.is_tradeable || !p.market_price || p.market_price <= 0) continue;
      const total = p.attack_power_bonus + p.protection_bonus;
      if (total === 0) continue;
      const ratio = p.market_price / total;
      if (!best || ratio < best.ratio) best = { id: p.id, ratio };
    }
    return best?.id ?? null;
  }, [combat]);

  return (
    <div className="container mx-auto p-4 max-w-5xl space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/assault"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" />Assault</Button></Link>
        <FlaskConical className="h-6 w-6 text-orange-500" />
        <h1 className="text-2xl font-bold">Potion Planner</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">How potions stack</CardTitle>
          <CardDescription className="text-xs">
            4 slots: <strong>Battle XP</strong>, <strong>Combat XP</strong>, <strong>Attack</strong>, <strong>Protection</strong>. One potion per slot. Combo potions (Thunderfury / Cosmic Tear / Phoenix Ashes) fill both attack + protection.
          </CardDescription>
        </CardHeader>
      </Card>

      <div>
        <h2 className="text-sm font-semibold mb-2">Preset tiers</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {presets.map((p) => (
            <PresetTierCard key={p.id} preset={p} combat={combat} xp={xp} onLoad={() => loadPreset(p)} />
          ))}
        </div>
      </div>

      <LoadoutSummary loadout={loadout} combat={combat} xp={xp} onRemoveCombat={removeCombat} onRemoveXp={removeXp} />

      {user ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Save loadout</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2 flex-wrap items-center">
              <Input value={name} onChange={(e) => setName(e.target.value)} className="max-w-xs" placeholder="Loadout name" />
              <label className="flex items-center gap-1 text-sm cursor-pointer">
                <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
                <Star className="h-3.5 w-3.5" /> Default
              </label>
              <Button onClick={save} disabled={saving} size="sm">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Save className="h-3.5 w-3.5 mr-1" />}
                {editingId ? 'Update' : 'Save'}
              </Button>
              {editingId && (
                <Button variant="ghost" size="sm" onClick={() => { setEditingId(null); setName('My loadout'); setLoadout(EMPTY); }}>
                  New
                </Button>
              )}
            </div>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {saved.length > 0 && (
              <div className="space-y-1">
                {saved.map((s) => (
                  <div key={s.id} className="flex items-center gap-2 text-sm border rounded px-2 py-1">
                    <span className="flex-1 truncate">
                      {s.is_default && <Star className="inline h-3 w-3 text-amber-400 mr-1" />}
                      {s.name}
                    </span>
                    <Button variant="ghost" size="sm" onClick={() => loadSaved(s)}>Edit</Button>
                    <Button variant="ghost" size="sm" onClick={() => del(s.id)}>Delete</Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-4 text-sm text-muted-foreground">Sign in to save loadouts.</CardContent>
        </Card>
      )}

      <Tabs defaultValue="battle">
        <TabsList>
          <TabsTrigger value="battle">Battle XP</TabsTrigger>
          <TabsTrigger value="combat">Combat XP</TabsTrigger>
          <TabsTrigger value="stats">Combat Stats</TabsTrigger>
        </TabsList>

        <TabsContent value="battle" className="space-y-2">
          {xpByCategory('battle_xp').map((p) => {
            const selected = xpSelected.has(p.id);
            const check = canAddXpPotion(p, state);
            return (
              <PotionCard
                key={p.id}
                potion={p}
                kind="xp"
                selected={selected}
                disabled={!selected && !check.ok}
                disabledReason={check.reason}
                onAdd={() => addXp(p)}
                onRemove={() => removeXp(p.id)}
              />
            );
          })}
        </TabsContent>

        <TabsContent value="combat" className="space-y-2">
          {xpByCategory('combat_xp').map((p) => {
            const selected = xpSelected.has(p.id);
            const check = canAddXpPotion(p, state);
            return (
              <PotionCard
                key={p.id}
                potion={p}
                kind="xp"
                selected={selected}
                disabled={!selected && !check.ok}
                disabledReason={check.reason}
                onAdd={() => addXp(p)}
                onRemove={() => removeXp(p.id)}
              />
            );
          })}
        </TabsContent>

        <TabsContent value="stats" className="space-y-2">
          <p className="text-xs text-muted-foreground">
            All Combat Stat potions share 2 slots (Attack + Protection). Pure attack/protection potions fill one slot each. Combo potions (Thunderfury / Cosmic Tear / Phoenix) fill both. Sorted by total stat bonus. ⭐ = best gold-per-stat.
          </p>
          {combatSorted.map((p) => {
            const selected = combatSelected.has(p.id);
            const check = canAddCombatPotion(p, state);
            const total = p.attack_power_bonus + p.protection_bonus;
            const perStat = p.is_tradeable && p.market_price && total > 0 ? Math.round(p.market_price / total) : null;
            return (
              <div key={p.id} className="space-y-1">
                <PotionCard
                  potion={p}
                  kind="combat"
                  selected={selected}
                  disabled={!selected && !check.ok}
                  disabledReason={check.reason}
                  onAdd={() => addCombat(p)}
                  onRemove={() => removeCombat(p.id)}
                />
                <div className="text-[11px] text-muted-foreground pl-14 flex gap-3">
                  <span>Total: +{total} stat</span>
                  {perStat != null && <span>{perStat.toLocaleString()}g / stat</span>}
                  {bestValueId === p.id && <span className="text-amber-400">⭐ best gold / stat</span>}
                </div>
              </div>
            );
          })}
        </TabsContent>
      </Tabs>
    </div>
  );
}
