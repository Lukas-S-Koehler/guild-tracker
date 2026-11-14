'use client';

import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { QualityBadge } from './QualityBadge';
import type { CombatPotion, XpPotion } from '@/lib/potion-rules';
import { Sparkles, Plus, Check, Ban } from 'lucide-react';

interface Props {
  potion: CombatPotion | XpPotion;
  kind: 'combat' | 'xp';
  selected?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onAdd?: () => void;
  onRemove?: () => void;
}

function syncAge(iso: string | null): string {
  if (!iso) return 'never';
  const diffMs = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diffMs / 3_600_000);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function PotionCard({ potion, kind, selected, disabled, disabledReason, onAdd, onRemove }: Props) {
  const isCombat = kind === 'combat';
  const combat = isCombat ? (potion as CombatPotion) : null;
  const xp = isCombat ? null : (potion as XpPotion);
  const isFreeCommon = xp?.is_free_common === true;
  const untradable = combat ? !combat.is_tradeable : false;

  const fmtCombat = (val: number, pct: boolean, label: string) =>
    `+${val}${pct ? '%' : ''} ${label}`;
  const bonusLine = combat
    ? [
        combat.attack_power_bonus > 0 && fmtCombat(combat.attack_power_bonus, combat.attack_power_is_percentage, 'ATK'),
        combat.protection_bonus > 0 && fmtCombat(combat.protection_bonus, combat.protection_is_percentage, 'PROT'),
      ]
        .filter(Boolean)
        .join(' · ')
    : xp
      ? `+${xp.xp_value || xp.effect_value}% ${xp.category === 'battle_xp' ? 'Battle XP' : 'Combat XP'}${xp.efficiency_value ? ` · +${xp.efficiency_value}% hunting efficiency` : ''}`
      : '';

  return (
    <div className={`border rounded-lg p-3 flex gap-3 ${selected ? 'border-orange-500/70 bg-orange-500/5' : 'border-border'} ${disabled && !selected ? 'opacity-60' : ''}`}>
      {potion.image_url ? (
        <Image src={potion.image_url} alt={potion.name} width={44} height={44} className="h-11 w-11 rounded flex-shrink-0 object-contain bg-muted/40" unoptimized />
      ) : (
        <div className="h-11 w-11 rounded bg-muted/40 flex-shrink-0 flex items-center justify-center text-muted-foreground"><Sparkles className="h-5 w-5" /></div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium truncate">{potion.name}</span>
          <QualityBadge quality={(combat?.quality ?? xp?.quality) ?? null} />
          {untradable && <span className="text-[10px] uppercase tracking-wide text-muted-foreground border border-border rounded px-1">Untradable</span>}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">{bonusLine}</div>
        <div className="text-xs mt-1 flex gap-3 flex-wrap">
          {potion.market_price != null && potion.market_price > 0 && (
            <span title={`Synced ${syncAge(potion.last_price_sync)}`}>
              {potion.market_price.toLocaleString()}g
            </span>
          )}
          {potion.duration_minutes && <span className="text-muted-foreground">{potion.duration_minutes}m</span>}
        </div>
        {isFreeCommon && (
          <div className="text-[11px] text-emerald-500/80 mt-1 italic">Often free from campaign / daily rewards.</div>
        )}
        {disabled && disabledReason && !selected && (
          <div className="text-[11px] text-destructive/80 mt-1 flex items-center gap-1"><Ban className="h-3 w-3" />{disabledReason}</div>
        )}
      </div>
      <div className="flex-shrink-0 flex items-start">
        {selected ? (
          <Button size="sm" variant="outline" onClick={onRemove}><Check className="h-3.5 w-3.5 mr-1" />In loadout</Button>
        ) : (
          <Button size="sm" variant="outline" disabled={disabled} onClick={onAdd}><Plus className="h-3.5 w-3.5 mr-1" />Add</Button>
        )}
      </div>
    </div>
  );
}
