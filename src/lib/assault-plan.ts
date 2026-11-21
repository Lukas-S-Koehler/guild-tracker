import { createAdminClient } from '@/lib/supabase-server';
import { upsertAssaultConfig, listAssaultConfigs } from '@/lib/assault-service';

export const KILLS_PER_HOUR = 1200; // 3s per kill

export interface PlannedLoot {
  name: string;
  quantity: number;
  chance: number;
  price: number;
  image_url?: string | null;
  quality?: string;
}

/** Real conquest locations are ids 1-10; anything above is an event zone and ignored. */
export const MAX_LOCATION_ID = 10;

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
  health?: number;
  experience?: number;
  chance_of_loot?: number;
  image_url?: string | null;
}

export interface ZonePlan {
  zone_id?: number | null;
  shrine?: boolean;
  priced_items?: number;
  total_items?: number;
  prices_updated_at?: string | null;
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
  health?: number;
  experience?: number;
  image_url?: string | null;
  loot: Array<{
    hashed_item_id: string;
    name: string;
    quantity: number;
    chance: number;
    quality?: string;
    image_url?: string | null;
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
    image_url: d.image_url ?? null,
    quality: d.quality,
  }));
  const innerEv = lootWithPrices.reduce((s, d) => s + (d.chance / 100) * d.quantity * d.price, 0);
  const ev = (row.chance_of_loot / 100) * innerEv;
  return { ev, loot: lootWithPrices };
}

async function loadPrices(itemNames: string[]): Promise<{ prices: Map<string, number>; updatedAt: string | null }> {
  const supabase = createAdminClient();
  const unique = Array.from(new Set(itemNames.map((n) => n.toLowerCase())));
  const map = new Map<string, number>();
  if (unique.length === 0) return { prices: map, updatedAt: null };
  let updatedAt: string | null = null;
  // chunk to keep the IN() list reasonable
  for (let i = 0; i < unique.length; i += 200) {
    const { data } = await supabase
      .from('market_cache')
      .select('item_name, price, cached_at')
      .in('item_name', unique.slice(i, i + 200));
    for (const row of data ?? []) {
      map.set((row.item_name as string).toLowerCase(), row.price as number);
      const at = row.cached_at as string | null;
      if (at && Number(row.price) > 0 && (!updatedAt || at > updatedAt)) updatedAt = at;
    }
  }
  return { prices: map, updatedAt };
}

const ENEMY_COLUMNS = 'id, name, level, zone_id, zone_name, chance_of_loot, health, experience, image_url, loot';

function buildPlan(zoneName: string, rows: EnemyRow[], prices: Map<string, number>, updatedAt: string | null): ZonePlan {
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
      health: r.health,
      experience: r.experience,
      chance_of_loot: r.chance_of_loot,
      image_url: r.image_url ?? null,
    };
  });

  enemies.sort((a, b) => b.gph - a.gph);
  const best = enemies[0] ?? null;
  const levels = enemies.map((e) => e.level);
  const allLoot = enemies.flatMap((e) => e.loot);
  const name = best?.zone_name ?? zoneName;
  return {
    zone_id: best?.zone_id ?? null,
    shrine: SHRINE_ZONES.has(name),
    priced_items: allLoot.filter((l) => l.price > 0).length,
    total_items: allLoot.length,
    prices_updated_at: updatedAt,
    zone: name,
    enemies,
    total_gph: best?.gph ?? 0,
    best_enemy: best,
    level_min: levels.length ? Math.min(...levels) : null,
    level_max: levels.length ? Math.max(...levels) : null,
  };
}

export async function getZonePlan(zoneName: string): Promise<ZonePlan> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('combat_enemies')
    .select(ENEMY_COLUMNS)
    .ilike('zone_name', zoneName);
  const rows = (data as EnemyRow[]) ?? [];
  const { prices, updatedAt } = await loadPrices(rows.flatMap((r) => (r.loot ?? []).map((l) => l.name)));
  return buildPlan(zoneName, rows, prices, updatedAt);
}

export async function getZonePlanById(zoneId: number): Promise<ZonePlan> {
  const supabase = createAdminClient();
  const { data } = await supabase.from('combat_enemies').select(ENEMY_COLUMNS).eq('zone_id', zoneId);
  const rows = (data as EnemyRow[]) ?? [];
  const { prices, updatedAt } = await loadPrices(rows.flatMap((r) => (r.loot ?? []).map((l) => l.name)));
  return buildPlan('', rows, prices, updatedAt);
}

/** All real conquest locations (ids 1-10) with enemies and EV, ordered by id. */
export async function listLocationPlans(): Promise<ZonePlan[]> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('combat_enemies')
    .select(ENEMY_COLUMNS)
    .gte('zone_id', 1)
    .lte('zone_id', MAX_LOCATION_ID);
  const rows = (data as EnemyRow[]) ?? [];
  const { prices, updatedAt } = await loadPrices(rows.flatMap((r) => (r.loot ?? []).map((l) => l.name)));
  const byZone = new Map<number, EnemyRow[]>();
  for (const r of rows) byZone.set(r.zone_id, [...(byZone.get(r.zone_id) ?? []), r]);
  return Array.from(byZone.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, zr]) => buildPlan('', zr, prices, updatedAt));
}

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function zoneFields(plan: ZonePlan) {
  return {
    zone_name: plan.zone,
    tracked_zone_id: plan.zone_id ?? null,
    tracked_zone_key: slug(plan.zone),
    level_range: plan.level_min == null ? '' : plan.level_min === plan.level_max ? `${plan.level_min}` : `${plan.level_min}–${plan.level_max}`,
    shrine_info: shrineInfoFor(plan.zone),
    enemy_priority: plan.enemies.map((e) => ({ name: e.name, level: e.level, gold_per_hr: e.gph })),
  };
}

/** Admin picks a location; zone name/id/key, level range, shrine and gold-ranked enemies are derived. */
export async function applyZoneSelection(guildId: string, zoneId: number) {
  if (zoneId < 1 || zoneId > MAX_LOCATION_ID) throw new Error('Location must be id 1-10 (event zones are ignored)');
  const plan = await getZonePlanById(zoneId);
  if (plan.enemies.length === 0) throw new Error(`No enemies cached for location ${zoneId}. Run combat-enemies-sync first.`);
  return upsertAssaultConfig(guildId, zoneFields(plan));
}

/** Re-derive enemy gold values + ranges for every configured zone (after price/enemy syncs). */
export async function refreshAllZoneSnapshots(): Promise<number> {
  const configs = await listAssaultConfigs();
  let n = 0;
  for (const c of configs) {
    const id = c.tracked_zone_id;
    if (!id || id > MAX_LOCATION_ID) continue;
    const ep = c.enemy_priority ?? [];
    if (ep.length === 1 && ep[0].level === 0) continue; // manual mob_order override
    const plan = await getZonePlanById(id);
    if (plan.enemies.length === 0) continue;
    await upsertAssaultConfig(c.guild_id, zoneFields(plan));
    n++;
  }
  return n;
}

export async function listZones(): Promise<string[]> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('combat_enemies')
    .select('zone_name, level')
    .gte('zone_id', 1)
    .lte('zone_id', MAX_LOCATION_ID)
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
