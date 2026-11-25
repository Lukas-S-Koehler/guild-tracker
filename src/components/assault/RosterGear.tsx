'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, Pencil, Shield } from 'lucide-react';
import type { RosterGear, RosterRow } from '@/lib/assault-roster';
import { GEAR_SLOTS, HAND_SLOT_CONFLICTS, MAX_TIER, type GearSelection } from '@/lib/combat/character-stats';

interface CatalogItem {
  id: number;
  name: string;
  slot: string;
  quality: string;
  combat_level: number;
  max_tier: number | null;
  image_url: string | null;
}

/** Same gear colours as /combat. */
const QUALITY_TEXT: Record<string, string> = { legendary: 'text-yellow-500', mythic: 'text-orange-500' };
const QUALITY_RING: Record<string, string> = {
  legendary: 'border-yellow-500/60 bg-yellow-500/5',
  mythic: 'border-orange-500/70 bg-orange-500/5',
};

const label = (g: { name: string; tier: number } | undefined) => (g ? `${g.name} T${g.tier}` : 'empty');

/**
 * Gear the character has saved on /combat. Leaders can edit it for members ranked below them;
 * every save goes through a confirmation that lists the changes.
 */
export function GearSection({ r, canEdit, onSaved }: { r: RosterRow; canEdit: boolean; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [catalog, setCatalog] = useState<CatalogItem[] | null>(null);
  const [draft, setDraft] = useState<GearSelection[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Reset when another character opens or the saved gear changes.
  const savedKey = JSON.stringify(r.gear.map((g) => [g.slot, g.gear_item_id, g.tier]));
  useEffect(() => {
    setEditing(false);
    setConfirming(false);
    setMsg(null);
  }, [r.member_id, savedKey]);

  const startEdit = async () => {
    setMsg(null);
    setDraft(r.gear.map((g) => ({ slot: g.slot, gear_item_id: g.gear_item_id, tier: g.tier })));
    setEditing(true);
    if (!catalog) {
      const res = await fetch('/api/assault/roster/gear', { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return setMsg(json.error ?? 'Could not load the gear list');
      setCatalog(json.catalog);
    }
  };

  const byId = useMemo(() => new Map((catalog ?? []).map((c) => [c.id, c])), [catalog]);
  const savedBySlot = new Map(r.gear.map((g) => [g.slot, g]));
  const draftBySlot = new Map(draft.map((g) => [g.slot, g]));
  const draftItem = (slot: string) => {
    const g = draftBySlot.get(slot);
    const item = g ? byId.get(g.gear_item_id) : undefined;
    return g && item ? { name: item.name, tier: g.tier } : undefined;
  };

  const changes = GEAR_SLOTS.map(({ key, label: slotLabel }) => {
    const before = savedBySlot.get(key);
    const after = draftBySlot.get(key);
    const same = (!before && !after) || (before && after && before.gear_item_id === after.gear_item_id && before.tier === after.tier);
    return same ? null : { slot: slotLabel, from: label(before), to: label(draftItem(key)) };
  }).filter((c): c is NonNullable<typeof c> => !!c);

  const equip = (slot: string, itemId: number | null) => {
    let next = draft.filter((g) => g.slot !== slot);
    if (itemId) {
      const conflicts = HAND_SLOT_CONFLICTS[slot] ?? [];
      next = next.filter((g) => !conflicts.includes(g.slot));
      next.push({ slot, gear_item_id: itemId, tier: savedBySlot.get(slot)?.gear_item_id === itemId ? savedBySlot.get(slot)!.tier : 1 });
    }
    setDraft(next);
  };
  const setTier = (slot: string, tier: number) => setDraft(draft.map((g) => (g.slot === slot ? { ...g, tier } : g)));

  const save = async () => {
    setBusy(true);
    setMsg(null);
    const res = await fetch('/api/assault/roster/gear', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ member_id: r.member_id, gear: draft }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    setConfirming(false);
    if (!res.ok) return setMsg(json.error ?? 'Save failed');
    setEditing(false);
    onSaved();
  };

  return (
    <section className="rounded-lg border p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold flex items-center gap-1.5"><Shield className="h-4 w-4" />Gear</h3>
        {canEdit && !editing && (
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={startEdit}>
            <Pencil className="h-3 w-3 mr-1" />Edit gear
          </Button>
        )}
      </div>
      {msg && <p className="text-xs text-red-500">{msg}</p>}
      {r.gear_from_staff && !editing && (
        <p className="text-[11px] text-muted-foreground">Entered by a leader (character not claimed yet). It moves to their /combat once they claim it.</p>
      )}

      {!editing ? (
        r.gear.length ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {GEAR_SLOTS.map(({ key, label: slotLabel }) => {
              const g = savedBySlot.get(key) as RosterGear | undefined;
              if (!g) return null;
              return (
                <div key={key} className={`flex items-center gap-2 rounded-md border px-2 py-1 ${QUALITY_RING[g.quality] ?? ''}`}>
                  <div className="h-8 w-8 shrink-0 rounded bg-muted/40 flex items-center justify-center overflow-hidden">
                    {g.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={g.image_url} alt="" className="h-7 w-7 object-contain" />
                    ) : (
                      <span className="text-[9px] text-muted-foreground">{slotLabel}</span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className={`text-xs font-medium truncate ${QUALITY_TEXT[g.quality] ?? ''}`}>{g.name}</div>
                    <div className="text-[10px] text-muted-foreground">{slotLabel} · T{g.tier}</div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No gear saved on /combat yet.</p>
        )
      ) : !catalog ? (
        <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin" /></div>
      ) : (
        <div className="space-y-2">
          <div className="grid gap-1.5">
            {GEAR_SLOTS.map(({ key, label: slotLabel }) => {
              const sel = draftBySlot.get(key);
              const item = sel ? byId.get(sel.gear_item_id) : undefined;
              const maxTier = item?.max_tier ?? MAX_TIER[item?.quality ?? 'legendary'] ?? 16;
              return (
                <div key={key} className={`flex items-center gap-2 rounded-md border p-1.5 ${item ? QUALITY_RING[item.quality] ?? '' : 'border-dashed'}`}>
                  <select
                    className="h-7 flex-1 min-w-0 rounded-md border bg-background px-2 text-xs"
                    value={sel?.gear_item_id ?? ''}
                    disabled={busy}
                    onChange={(e) => equip(key, e.target.value ? Number(e.target.value) : null)}
                  >
                    <option value="">{slotLabel}: empty</option>
                    {catalog.filter((c) => c.slot === key).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} · CL{c.combat_level}{c.combat_level > (r.combat_level ?? 0) ? ' 🔒' : ''}
                      </option>
                    ))}
                  </select>
                  {sel && (
                    <div className="flex items-center shrink-0 border rounded">
                      <button className="px-1.5 text-sm hover:bg-muted disabled:opacity-30" disabled={busy || sel.tier <= 1} onClick={() => setTier(key, sel.tier - 1)}>−</button>
                      <span className="text-xs w-9 text-center font-medium">T{sel.tier}</span>
                      <button className="px-1.5 text-sm hover:bg-muted disabled:opacity-30" disabled={busy || sel.tier >= maxTier} onClick={() => setTier(key, sel.tier + 1)}>+</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {confirming ? (
            <div className="rounded-md border border-amber-500/50 bg-amber-500/5 p-2 space-y-2">
              <p className="text-xs font-medium">Save these gear changes for {r.ign}? This also changes their /combat gear.</p>
              <ul className="text-[11px] space-y-0.5">
                {changes.map((c) => (
                  <li key={c.slot}>
                    <span className="text-muted-foreground">{c.slot}:</span> {c.from} → <b>{c.to}</b>
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <Button size="sm" className="h-7 text-xs" disabled={busy} onClick={save}>
                  {busy && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}Confirm
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={busy} onClick={() => setConfirming(false)}>Back</Button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2 items-center">
              <Button size="sm" className="h-7 text-xs" disabled={!changes.length} onClick={() => setConfirming(true)}>
                Save{changes.length ? ` (${changes.length} change${changes.length > 1 ? 's' : ''})` : ''}
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditing(false)}>Cancel</Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
