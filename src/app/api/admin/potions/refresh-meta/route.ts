import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createServerClient } from '@/lib/supabase-server';
import { IdleMMOApi } from '@/lib/idlemmo-api';
import { fetchPotionMeta, searchItemHashedId, type PotionEffect } from '@/lib/idlemmo-potion-meta';

export const dynamic = 'force-dynamic';

const SUPER_ADMIN_USER_ID = '5f33bb41-86ab-4024-a1da-6a2fea5fb36b';
const SUPER_ADMIN_EMAIL = 'motivationluki@gmail.com';

interface CombatSync {
  duration_minutes: number | null;
  attack_power_bonus: number;
  protection_bonus: number;
  attack_power_is_percentage: boolean;
  protection_is_percentage: boolean;
  quality: string;
  vendor_price: number;
  is_tradeable: boolean;
  image_url: string | null;
}

interface XpSync {
  duration_minutes: number | null;
  xp_value: number;
  efficiency_value: number;
  quality: string;
  image_url: string | null;
}

function isPercentEffect(e: PotionEffect): boolean {
  const vt = (e.value_type ?? '').toLowerCase();
  return vt === 'percentage' || vt === 'percent' || vt === '%';
}

function extractCombatStats(effects: PotionEffect[]): {
  attack: number;
  protection: number;
  attackPct: boolean;
  protPct: boolean;
} {
  let attack = 0, protection = 0;
  let attackPct = false, protPct = false;
  for (const e of effects) {
    if (e.target === 'attack_power') {
      if (e.value > attack) { attack = e.value; attackPct = isPercentEffect(e); }
    } else if (e.target === 'protection') {
      if (e.value > protection) { protection = e.value; protPct = isPercentEffect(e); }
    }
  }
  return { attack, protection, attackPct, protPct };
}

function extractXpStats(effects: PotionEffect[], category: 'battle_xp' | 'combat_xp'): { xp: number; eff: number } {
  // combat_xp: only combat experience (ignore dungeoneering + dungeon efficiency)
  // battle_xp: battle experience + hunting wait_length efficiency
  let xp = 0, eff = 0;
  for (const e of effects) {
    if (e.attribute === 'experience') {
      if (category === 'combat_xp' && e.target === 'combat') {
        xp = Math.max(xp, e.value);
      } else if (category === 'battle_xp' && e.target === 'battle') {
        xp = Math.max(xp, e.value);
      }
    } else if (
      category === 'battle_xp' &&
      e.attribute === 'wait_length' &&
      e.value_type === 'efficiency' &&
      e.target === 'hunting'
    ) {
      eff = Math.max(eff, e.value);
    }
  }
  return { xp, eff };
}

async function run(req: NextRequest) {
  const supabase = createServerClient(req);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });

  let allowed = user.email === SUPER_ADMIN_EMAIL || user.id === SUPER_ADMIN_USER_ID;
  if (!allowed) {
    const { data: leader } = await supabase
      .from('guild_leaders').select('role').eq('user_id', user.id).eq('role', 'LEADER').limit(1).maybeSingle();
    allowed = !!leader;
  }
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const admin = createAdminClient();

  const { data: keyRow } = await admin
    .from('user_api_keys').select('api_key').eq('user_id', SUPER_ADMIN_USER_ID).single();
  if (!keyRow?.api_key) return NextResponse.json({ error: 'No API key for super admin' }, { status: 400 });
  const api = new IdleMMOApi(keyRow.api_key);

  const debug = req.nextUrl.searchParams.get('debug') === '1';

  const [{ data: combat }, { data: xp }] = await Promise.all([
    admin.from('combat_potions').select('id, name, hashed_item_id'),
    admin.from('xp_potions').select('id, name, category, hashed_item_id'),
  ]);

  const results = {
    combat_updated: 0,
    xp_updated: 0,
    resolved_hashes: [] as string[],
    skipped: [] as string[],
    debug_samples: [] as Array<{ name: string; source: string; sample?: unknown }>,
  };

  for (const row of combat ?? []) {
    let hash = row.hashed_item_id;
    if (!hash) {
      hash = await searchItemHashedId(api, row.name);
      if (hash) {
        await admin.from('combat_potions').update({ hashed_item_id: hash }).eq('id', row.id);
        results.resolved_hashes.push(`${row.name} -> ${hash}`);
      } else {
        results.skipped.push(`${row.name} (no hash)`);
        continue;
      }
    }
    const meta = await fetchPotionMeta(api, hash);
    if (!meta.item) {
      results.skipped.push(row.name);
      if (debug) results.debug_samples.push({ name: row.name, source: meta.source, sample: meta.rawSample });
      continue;
    }
    const { attack, protection, attackPct, protPct } = extractCombatStats(meta.item.effects ?? []);
    const payload: Partial<CombatSync> & { updated_at: string } = {
      duration_minutes: meta.durationMinutes,
      attack_power_bonus: attack,
      protection_bonus: protection,
      attack_power_is_percentage: attackPct,
      protection_is_percentage: protPct,
      quality: meta.item.quality,
      vendor_price: meta.item.vendor_price,
      is_tradeable: meta.item.is_tradeable,
      image_url: meta.item.image_url,
      updated_at: new Date().toISOString(),
    };
    await admin.from('combat_potions').update(payload).eq('id', row.id);
    results.combat_updated++;
    await new Promise((r) => setTimeout(r, 200));
  }

  for (const row of xp ?? []) {
    let hash = row.hashed_item_id;
    if (!hash) {
      hash = await searchItemHashedId(api, row.name);
      if (hash) {
        await admin.from('xp_potions').update({ hashed_item_id: hash }).eq('id', row.id);
        results.resolved_hashes.push(`${row.name} -> ${hash}`);
      } else {
        results.skipped.push(`${row.name} (no hash)`);
        continue;
      }
    }
    const meta = await fetchPotionMeta(api, hash);
    if (!meta.item) {
      results.skipped.push(row.name);
      if (debug) results.debug_samples.push({ name: row.name, source: meta.source, sample: meta.rawSample });
      continue;
    }
    const { xp: xpVal, eff } = extractXpStats(meta.item.effects ?? [], row.category as 'battle_xp' | 'combat_xp');
    const payload: Partial<XpSync> & { updated_at: string } = {
      duration_minutes: meta.durationMinutes,
      xp_value: xpVal,
      efficiency_value: eff,
      quality: meta.item.quality,
      image_url: meta.item.image_url,
      updated_at: new Date().toISOString(),
    };
    await admin.from('xp_potions').update(payload).eq('id', row.id);
    results.xp_updated++;
    await new Promise((r) => setTimeout(r, 200));
  }

  return NextResponse.json({ success: true, ...results });
}

export async function GET(req: NextRequest) { return run(req); }
export async function POST(req: NextRequest) { return run(req); }
