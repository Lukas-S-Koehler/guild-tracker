import { createAdminClient } from '@/lib/supabase-server';

export const KILLS_PER_HOUR = 1200; // 3s per kill

export interface PlannedLoot {
  name: string;
  quantity: number;
  chance: number;
  price: number;
}

export interface PlannedEnemy {
  id: number;
  name: string;
  level: number;
  zone_id: number;
  zone_name: string;
  ev_per_kill: number;
  gph: number;
  drop_count: number;
  loot: PlannedLoot[];
}

export interface ZonePlan {
  zone: string;
  enemies: PlannedEnemy[];
  total_gph: number;
  best_enemy: PlannedEnemy | null;
  level_min: number | null;
  level_max: number | null;
}

interface EnemyRow {
  id: number;
  name: string;
  level: number;
  zone_id: number;
  zone_name: string;
  chance_of_loot: number;
  loot: Array<{
    hashed_item_id: string;
    name: string;
    quantity: number;
    chance: number;
    quality?: string;
  }>;
}

// EV/kill = (chance_of_loot/100) * Σ (chance_i/100 * qty_i * price_i)
// chance_of_loot gates whether any drop occurs; per-item chance rolls within.
function computeEvPerKill(row: EnemyRow, prices: Map<string, number>): { ev: number; loot: PlannedLoot[] } {
  const lootWithPrices: PlannedLoot[] = row.loot.map((d) => ({
    name: d.name,
    quantity: d.quantity,
    chance: d.chance,
    price: prices.get(d.name.toLowerCase()) ?? 0,
  }));
  const innerEv = lootWithPrices.reduce((s, d) => s + (d.chance / 100) * d.quantity * d.price, 0);
  const ev = (row.chance_of_loot / 100) * innerEv;
  return { ev, loot: lootWithPrices };
}

async function loadPrices(itemNames: string[]): Promise<Map<string, number>> {
  const supabase = createAdminClient();
  const unique = Array.from(new Set(itemNames.map((n) => n.toLowerCase())));
  if (unique.length === 0) return new Map();
  const { data } = await supabase
    .from('market_cache')
    .select('item_name, price')
    .in('item_name', unique);
  const map = new Map<string, number>();
  for (const row of data ?? []) {
    map.set((row.item_name as string).toLowerCase(), row.price as number);
  }
  return map;
}

export async function getZonePlan(zoneName: string): Promise<ZonePlan> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('combat_enemies')
    .select('id, name, level, zone_id, zone_name, chance_of_loot, loot')
    .ilike('zone_name', zoneName);

  const rows = (data as EnemyRow[]) ?? [];
  const itemNames = rows.flatMap((r) => (r.loot ?? []).map((l) => l.name));
  const prices = await loadPrices(itemNames);

  const enemies: PlannedEnemy[] = rows.map((r) => {
    const { ev, loot } = computeEvPerKill(r, prices);
    return {
      id: r.id,
      name: r.name,
      level: r.level,
      zone_id: r.zone_id,
      zone_name: r.zone_name,
      ev_per_kill: ev,
      gph: Math.round(ev * KILLS_PER_HOUR),
      drop_count: r.loot?.length ?? 0,
      loot,
    };
  });

  enemies.sort((a, b) => b.gph - a.gph);
  const best = enemies[0] ?? null;
  const levels = enemies.map((e) => e.level);
  return {
    zone: best?.zone_name ?? zoneName,
    enemies,
    total_gph: best?.gph ?? 0,
    best_enemy: best,
    level_min: levels.length ? Math.min(...levels) : null,
    level_max: levels.length ? Math.max(...levels) : null,
  };
}

export async function listZones(): Promise<string[]> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('combat_enemies')
    .select('zone_name, level')
    .order('level', { ascending: true });
  const seen = new Set<string>();
  const result: string[] = [];
  for (const row of data ?? []) {
    const name = row.zone_name as string;
    if (!seen.has(name)) {
      seen.add(name);
      result.push(name);
    }
  }
  return result;
}

// Shrine-bearing locations (fixed by game).
export const SHRINE_ZONES = new Set<string>([
  'Bluebell Hollow',
  'Eldoria',
  'Skyreach Peak',
  'Isle of Whispers',
  'The Citadel',
  'Floating Gardens of Aetheria',
]);

export function shrineInfoFor(zone: string): string {
  return SHRINE_ZONES.has(zone) ? 'On-site Shrine' : 'No on-site shrine';
}
