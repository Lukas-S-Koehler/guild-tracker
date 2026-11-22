/**
 * Potion advisor: given a character, buffs and a stack of hunted enemies,
 * evaluate every slot-legal potion setup (one attack-slot potion + one
 * protection-slot potion; combo potions occupy both) and rank them.
 *
 * Time model: assault guide HITS_TO_KILL (2 hits = 3s floor … 5 hits = 7.23s).
 * Potions needed = ceil(total battle minutes / potion duration).
 */
import { applyBuffs, type BuffState, type StatBlock } from './character-stats';
import { matchup } from './formulas';

export interface AdvisorPotion {
  id: number;
  name: string;
  quality: string;
  attack_power_bonus: number;
  protection_bonus: number;
  duration_minutes: number | null;
  price: number | null;
  image_url: string | null;
}

export interface AdvisorEnemy {
  id: number | null;
  name: string;
  level: number;
  hp: number;
  count: number;
  slayerPct: number;
}

export interface AdvisorInput {
  base: StatBlock;
  critChance: number;
  critDamage: number;
  damageFlat: number;
  /** Siege buffs only — potion % comes from the candidate being evaluated. */
  buffs: BuffState;
  enemies: AdvisorEnemy[];
  potions: AdvisorPotion[];
}

export interface EnemyOutcome {
  name: string;
  count: number;
  hits: number | null;
  secondsPerKill: number | null;
  damageTakenPerKill: number;
}

export interface AdvisorOption {
  key: string;
  attackPotion: AdvisorPotion | null;
  protectionPotion: AdvisorPotion | null;
  /** Same object in both slots when a combo potion is used. */
  isCombo: boolean;
  attackPower: number;
  protection: number;
  totalSeconds: number;
  totalDamageTaken: number;
  killable: boolean;
  quantities: { potion: AdvisorPotion; qty: number }[];
  cost: number;
  /** vs baseline (no potions) */
  secondsSaved: number;
  damageSaved: number;
  breakpointsGained: number;
  perEnemy: EnemyOutcome[];
}

export interface AdvisorResult {
  baseline: AdvisorOption;
  options: AdvisorOption[];
  fastest: AdvisorOption | null;
  bestValue: AdvisorOption | null;
  tankiest: AdvisorOption | null;
  totalKills: number;
}

const DEFAULT_DURATION = 30;

function evaluate(
  input: AdvisorInput,
  attackPotion: AdvisorPotion | null,
  protectionPotion: AdvisorPotion | null,
  isCombo: boolean
): Omit<AdvisorOption, 'secondsSaved' | 'damageSaved' | 'breakpointsGained'> {
  const apPct = attackPotion?.attack_power_bonus ?? 0;
  const protPct = isCombo ? attackPotion?.protection_bonus ?? 0 : protectionPotion?.protection_bonus ?? 0;
  const buffed = applyBuffs(input.base, { ...input.buffs, apPotionPct: apPct, protPotionPct: protPct });

  let totalSeconds = 0;
  let totalDamageTaken = 0;
  let killable = true;
  const perEnemy: EnemyOutcome[] = [];

  for (const e of input.enemies) {
    if (e.count <= 0) continue;
    const m = matchup(
      {
        attackPower: buffed.attackPower,
        protection: buffed.protection,
        agility: buffed.agility,
        accuracy: buffed.accuracy,
        critChance: input.critChance,
        critDamage: input.critDamage,
        damageFlat: input.damageFlat,
      },
      { level: e.level, hp: e.hp },
      e.slayerPct
    );
    if (m.hits == null || m.secondsPerKill == null) killable = false;
    totalSeconds += (m.secondsPerKill ?? 0) * e.count;
    totalDamageTaken += m.damageTakenPerKill * e.count;
    perEnemy.push({
      name: e.name,
      count: e.count,
      hits: m.hits,
      secondsPerKill: m.secondsPerKill,
      damageTakenPerKill: m.damageTakenPerKill,
    });
  }

  const minutes = totalSeconds / 60;
  const used = isCombo ? [attackPotion!] : [attackPotion, protectionPotion].filter(Boolean) as AdvisorPotion[];
  const quantities = used.map((p) => ({
    potion: p,
    qty: Math.max(1, Math.ceil(minutes / (p.duration_minutes || DEFAULT_DURATION))),
  }));
  const cost = quantities.reduce((sum, q) => sum + q.qty * (q.potion.price ?? 0), 0);

  const key = isCombo
    ? `combo:${attackPotion!.id}`
    : `a:${attackPotion?.id ?? 0}|p:${protectionPotion?.id ?? 0}`;

  return {
    key,
    attackPotion,
    protectionPotion: isCombo ? attackPotion : protectionPotion,
    isCombo,
    attackPower: buffed.attackPower,
    protection: buffed.protection,
    totalSeconds,
    totalDamageTaken,
    killable,
    quantities,
    cost,
    perEnemy,
  };
}

export function runAdvisor(input: AdvisorInput): AdvisorResult {
  const apOnly = input.potions.filter((p) => p.attack_power_bonus > 0 && p.protection_bonus === 0);
  const protOnly = input.potions.filter((p) => p.protection_bonus > 0 && p.attack_power_bonus === 0);
  const combos = input.potions.filter((p) => p.attack_power_bonus > 0 && p.protection_bonus > 0);

  const raw: ReturnType<typeof evaluate>[] = [];
  for (const a of [null, ...apOnly]) {
    for (const p of [null, ...protOnly]) raw.push(evaluate(input, a, p, false));
  }
  for (const c of combos) raw.push(evaluate(input, c, null, true));

  const baseRaw = raw[0];
  const totalKills = input.enemies.reduce((s, e) => s + Math.max(0, e.count), 0);

  const finish = (o: ReturnType<typeof evaluate>): AdvisorOption => {
    let breakpointsGained = 0;
    o.perEnemy.forEach((pe, i) => {
      const b = baseRaw.perEnemy[i];
      if (pe.hits != null && b?.hits != null) breakpointsGained += Math.max(0, b.hits - pe.hits) * pe.count;
    });
    return {
      ...o,
      secondsSaved: baseRaw.totalSeconds - o.totalSeconds,
      damageSaved: baseRaw.totalDamageTaken - o.totalDamageTaken,
      breakpointsGained,
    };
  };

  const baseline = finish(baseRaw);
  const options = raw.slice(1).map(finish);

  // Drop options strictly dominated by a cheaper-or-equal option (same/better time AND damage).
  const useful = options.filter(
    (o) =>
      (o.secondsSaved > 0.5 || o.damageSaved > 0.5) &&
      !options.some(
        (x) =>
          x !== o &&
          x.cost <= o.cost &&
          x.totalSeconds <= o.totalSeconds &&
          x.totalDamageTaken <= o.totalDamageTaken &&
          (x.cost < o.cost || x.totalSeconds < o.totalSeconds || x.totalDamageTaken < o.totalDamageTaken)
      )
  );
  useful.sort((a, b) => a.totalSeconds - b.totalSeconds || a.cost - b.cost);

  const fastest = useful.length ? useful[0] : null;
  const speedOpts = useful.filter((o) => o.secondsSaved > 0.5 && o.cost > 0);
  const bestValue = speedOpts.length
    ? speedOpts.reduce((best, o) => (o.secondsSaved / o.cost > best.secondsSaved / best.cost ? o : best))
    : null;
  const tankOpts = useful.filter((o) => o.damageSaved > 0.5);
  const tankiest = tankOpts.length
    ? tankOpts.reduce((best, o) =>
        o.totalDamageTaken < best.totalDamageTaken ||
        (o.totalDamageTaken === best.totalDamageTaken && o.cost < best.cost)
          ? o
          : best
      )
    : null;

  return { baseline, options: useful, fastest, bestValue, tankiest, totalKills };
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  const sec = s % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}
