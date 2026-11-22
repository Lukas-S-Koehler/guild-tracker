/**
 * Combat formulas ported 1:1 from public/tools/combat-calculator.html.
 * Calibrated against raw combat logs (AP 240–1650+, enemy levels 1–150).
 * Keep these pure — they are shared by the /combat page and the potion advisor.
 */

export const HP_TARGETS: Record<string, { min: number; max: number }> = {
  'Standard Mob': { min: 830, max: 1250 },
  "Will-o'-the-Wisp": { min: 830, max: 1250 },
  Kikimora: { min: 871, max: 1316 },
  'Man Moth': { min: 899, max: 1353 },
  Banshee: { min: 929, max: 1398 },
  'Arvendor Guardian': { min: 954, max: 1426 },
};

export const CREATURE_TYPES = Object.keys(HP_TARGETS);

const clampLevel = (L: number) => Math.max(1, Math.min(200, L));

export function enemyPower(L: number): number {
  const l = clampLevel(L);
  return Math.floor(1.974 * l + (l * l) / 208);
}

export function enemyAttackPower(L: number): number {
  const l = clampLevel(L);
  const dL = l - 100;
  let K = 505.035 + 6.502 * dL + 0.01628 * dL * dL;
  if (l > 15 && l < 100) K -= ((100 - l) * (l - 15)) / 650;
  return K;
}

export function enemyDefense(L: number): number {
  const l = clampLevel(L);
  const dL = l - 100;
  let D = 321 + 4.353 * dL + 0.0108 * dL * dL;
  if (l > 100) {
    D += 0.024 * dL;
  } else {
    D += 4.0 * (1 - l / 100);
    if (l >= 9 && l <= 11) D += 0.5;
  }
  return Math.max(0, D);
}

/** Player damage per landed hit. slayerPct = total slayer % (personal + guild). */
export function calcDamage(
  ap: number,
  critChancePct: number,
  critDamage: number,
  L: number,
  dmgFlat = 0,
  slayerPct = 0
): number {
  const D = enemyDefense(L);
  const baseHit = (0.665318 * ap * ap) / (ap + D);
  const withCrit = baseHit + (critChancePct * critDamage) / 100;
  const withSlayer = withCrit * (1 + slayerPct / 100);
  return Math.max(1, Math.round(withSlayer) + dmgFlat);
}

export function calcEnemyDamage(prot: number, L: number): number {
  const K = enemyAttackPower(L);
  return Math.max(1, Math.floor((0.66173 * K * K) / (K + prot)));
}

export function calcHitChance(acc: number, L: number): number {
  return Math.min(100, Math.max(0, (acc / (acc + enemyPower(L))) * 100));
}

export function calcEnemyHitChance(agi: number, L: number): number {
  const ep = enemyPower(L);
  return Math.min(100, Math.max(10, (ep / (ep + agi)) * 100));
}

function scaleValue(level: number, minL: number, maxL: number, minV: number, maxV: number, curve = 1) {
  const u = (level - minL) / (maxL - minL);
  return Math.floor(minV + (maxV - minV) * Math.pow(u, curve));
}

/** Estimated HP. Used for scaled enemies (Lv 100–150) or when no API HP is known. */
export function estimateHP(creature: string, L: number): number {
  if (L < 100) return Math.max(1, scaleValue(L, 1, 100, 23, 830));
  const mob = HP_TARGETS[creature] ?? HP_TARGETS['Standard Mob'];
  return Math.max(1, scaleValue(L, 100, 150, mob.min, mob.max));
}

export function hitsToKill(hp: number, dmg: number, hitChancePct: number): number | null {
  if (hp <= 0 || dmg <= 0 || hitChancePct <= 0) return null;
  const eff = Math.max(0.01, (dmg * hitChancePct) / 100);
  return Math.ceil(hp / eff);
}

/** Smallest AP that reaches `targetHits` (binary search, from HTML findAPForHits). */
export function findAPForHits(
  targetHits: number,
  hp: number,
  hc: number,
  cc: number,
  cd: number,
  L: number,
  dmgFlat: number,
  slayerPct: number,
  startAP: number
): number {
  if (hp <= 0 || hc <= 0) return startAP;
  const targetEff = hp / targetHits;
  const ok = (ap: number) => (calcDamage(ap, cc, cd, L, dmgFlat, slayerPct) * hc) / 100 >= targetEff;
  if (ok(startAP)) return startAP;
  let lo = startAP + 1;
  let hi = startAP + 100000;
  while (!ok(hi)) hi *= 2;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (ok(mid)) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

export function accuracyForHitChance(targetPct: number, L: number): number {
  const t = Math.min(99.9, Math.max(0.1, targetPct));
  return Math.ceil((t * enemyPower(L)) / (100 - t));
}

export function agilityForEnemyHitChance(targetPct: number, L: number): number {
  const t = Math.min(99.9, Math.max(10, targetPct));
  return Math.ceil((enemyPower(L) * (100 - t)) / t);
}

export function protectionForEnemyDamage(targetDmg: number, L: number): number {
  const t = Math.max(1, targetDmg);
  let lo = 0;
  let hi = 100000;
  while (calcEnemyDamage(hi, L) > t) hi *= 2;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (calcEnemyDamage(mid, L) <= t) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/* ─── Battle timing (from assault guide HITS_TO_KILL) ─── */

/** Seconds per kill by hits-to-kill. 2 hits = 3s floor; >5 extrapolated (suboptimal anyway). */
const SECONDS_PER_KILL: Record<number, number> = { 1: 3.0, 2: 3.0, 3: 4.53, 4: 6.18, 5: 7.23 };

export function secondsPerKill(hits: number): number {
  if (hits <= 5) return SECONDS_PER_KILL[Math.max(1, hits)];
  return 7.23 + (hits - 5) * 1.4;
}

/* ─── Full matchup ─── */

export interface FighterStats {
  attackPower: number;
  protection: number;
  agility: number;
  accuracy: number;
  critChance: number;
  critDamage: number;
  damageFlat: number;
}

export interface Matchup {
  damage: number;
  hitChance: number;
  enemyDamage: number;
  enemyHitChance: number;
  hits: number | null;
  /** Expected damage taken per kill: enemy swings ≈ player swings − 1 (player strikes first). */
  damageTakenPerKill: number;
  secondsPerKill: number | null;
}

export function matchup(s: FighterStats, enemy: { level: number; hp: number }, slayerPct = 0): Matchup {
  const L = Math.max(1, Math.round(enemy.level));
  const damage = calcDamage(s.attackPower, s.critChance, s.critDamage, L, s.damageFlat, slayerPct);
  const hitChance = calcHitChance(s.accuracy, L);
  const enemyDamage = calcEnemyDamage(s.protection, L);
  const enemyHitChance = calcEnemyHitChance(s.agility, L);
  const hits = hitsToKill(enemy.hp, damage, hitChance);
  const enemySwings = hits ? Math.max(0, hits - 1) : 0;
  return {
    damage,
    hitChance,
    enemyDamage,
    enemyHitChance,
    hits,
    damageTakenPerKill: (enemySwings * enemyDamage * enemyHitChance) / 100,
    secondsPerKill: hits ? secondsPerKill(hits) : null,
  };
}
