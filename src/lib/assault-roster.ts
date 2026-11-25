/**
 * Assault Roster read model (docs/assault-roster.md §2): what every assaulter in a guild runs
 * for battle and hunting, built from `assault_roster` snapshots plus /combat profiles,
 * default potion loadouts and the guild's tracked assault zone.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase-server';
import { getAccountCharacters, getAllClaimLocks } from '@/lib/account-service';
import { RANK, rankInGuild } from '@/lib/role-hierarchy';
import { SUPER_ADMIN_EMAIL } from '@/lib/auth-helpers';
import { ensureCustomPets } from '@/lib/combat/custom-pets-server';
import { resolveSpeciesName, petTier, PET_STATS } from '@/lib/combat/pet-data';
import { petHuntEstimate, squadHuntPower, petSquadSize, HUNT_STABLE_SIZE, type PetHuntEstimate } from '@/lib/combat/pet-hunting';
import { huntingBow, type HuntingBow } from '@/lib/combat/hunting-gear';
import {
  applyBuffs, buildCharacterStats, slayerByEnemy, NO_BUFFS, ZERO_STATS,
  type ApiEffect, type BuffState, type GearItem, type GearSelection, type StatLevels,
} from '@/lib/combat/character-stats';
import { matchup, estimateHP, HP_TARGETS, type FighterStats } from '@/lib/combat/formulas';
import { MAX_LOCATION_ID } from '@/lib/assault-plan';
import { RECOMMENDED_PRESET_ID } from '@/lib/potion-rules';
import { battleTier, mergeGoals, type GoalSet } from '@/lib/roster-goals';
import { computeMoves, type Move } from '@/lib/roster-moves';
import { hasMarketAccess } from '@/lib/combat/class-talents';
import { effectiveRsvp, nextWaveUnix, rsvpsForWave, type EffectiveRsvp, type RsvpStatus } from '@/lib/assault-rsvp';
import { HAND_SLOT_CONFLICTS } from '@/lib/combat/character-stats';
import { withPotions } from '@/app/combat/potion-slots';
import type { PotionRow } from '@/app/combat/types';

/* ─── access ─── */

export interface RosterGuild {
  id: string;
  name: string;
  nickname: string | null;
  /** Viewer is officer+ there (or super admin): may refresh the guild and flag non-assaulters. */
  isStaff: boolean;
}

/** Assault guilds the viewer may see: their own (character or site role there) or all for super admin. */
export async function viewableRosterGuilds(
  user: { id: string; email?: string },
  supabase: SupabaseClient = createAdminClient()
): Promise<RosterGuild[]> {
  const { data: guilds } = await supabase.from('guilds').select('id, name, nickname').eq('is_assault', true).order('name');
  const all = (guilds ?? []).map((g) => ({ id: String(g.id), name: g.name as string, nickname: (g.nickname as string) ?? null }));
  const isSuper = user.email === SUPER_ADMIN_EMAIL;
  let mine: Set<string>;
  if (isSuper) mine = new Set(all.map((g) => g.id));
  else {
    const [chars, { data: roles }] = await Promise.all([
      getAccountCharacters(user.id, supabase),
      supabase.from('guild_leaders').select('guild_id').eq('user_id', user.id),
    ]);
    mine = new Set([
      ...chars.filter((c) => c.in_dream_guild && c.guild_id).map((c) => c.guild_id as string),
      ...(roles ?? []).map((r) => String(r.guild_id)),
    ]);
  }
  const visible = all.filter((g) => mine.has(g.id));
  return Promise.all(
    visible.map(async (g) => ({ ...g, isStaff: (await rankInGuild(supabase, user, g.id)) >= RANK.OFFICER }))
  );
}

/* ─── read model ─── */

export type Participation = 'auto' | 'opt_in' | 'none';
export const PARTICIPATION: Participation[] = ['auto', 'opt_in', 'none'];

/** A potion in someone's default loadout, with the slot it fills. */
export interface RosterPotion {
  id: number;
  name: string;
  image_url: string | null;
  slot: 'attack' | 'protection' | 'combo' | 'battle_xp' | 'combat_xp';
  /** Short effect label, e.g. "+20% AP", "+30/15%", "+50% Battle XP". */
  effect: string;
}

export interface RosterPet extends PetHuntEstimate {
  name: string;
  /** Quality, or "Event" for event pets (display only). */
  tier: string;
  /** Pet level ≥ the location's lowest enemy level (pets below can't hunt there). */
  eligible: boolean;
  evolution: number;
  equipped: boolean;
  inSquad: boolean;
}

export interface RosterRow {
  member_id: string;
  ign: string;
  character_class: string | null;
  image_url: string | null;
  position: string | null;
  combat_level: number | null;
  hunting_mastery: number | null;
  pet_mastery: number | null;
  dexterity: number | null;
  /** Pet equipped in game right now (often a hunter, not the assault pet). */
  equipped_pet: { species: string | null; level: number; evolution: number; tier: string | null } | null;
  battle: {
    gearSet: boolean;
    loadout: string | null;
    loadoutPotions: RosterPotion[];
    /** The /assault/potions preset this loadout matches exactly, or null = custom. */
    preset: { id: string; label: string; recommended: boolean } | null;
    /** Assault tier of the loadout (0..5): best preset it matches or beats on AP/Prot/Battle XP/Combat XP. */
    potionTier: number;
    /** Best battle pet among ALL owned pets for this zone (fewest hits, then highest 2-hit scaling, then damage). */
    bestPet: { species: string; level: number; evolution: number; tier: string | null; equipped: boolean } | null;
    /** Hits are only meaningful with gear set on /combat. */
    computed: boolean;
    stats: { attackPower: number; protection: number; agility: number; accuracy: number; critChance: number; critDamage: number } | null;
    enemies: { id: number; name: string; level: number; hits: number | null }[];
    /** e.g. [{hits:2,count:2},{hits:3,count:4}] at the zone's own levels. */
    dist: { hits: number; count: number }[];
    worstHits: number | null;
    /** Enemy scaling: from CL 80 you scale to your own CL (fixed); at CL 100 you pick any level up to 150. */
    canScale: boolean;
    scaleMax: number;
    /** CL 80–99: scaling only at exactly your own CL. */
    scaleFixed: boolean;
    /** Highest scaled level where EVERY zone enemy still dies in 2 hits; null if not all 2 hits at base. */
    max2HitLevel: number | null;
    /** Cheapest single gear swap (base tier, market price) that reaches the next battle tier. */
    upgrade: { item: string; slot: string; price: number; toTier: number } | null;
  };
  hunting: {
    bow: HuntingBow | null;
    squadSize: number;
    /** Pets evaluated for hunting (two rotating squads: hunt, then sleep). */
    stableSize: number;
    /** Citadel est. encounters per hunt over the best `stableSize` ELIGIBLE pets. */
    squadPower: number;
    /** Pets must be at least this level to hunt at the selected location. */
    minPetLevel: number;
    eligibleCount: number;
    bestPet: { species: string; level: number; citadelEncounters: number } | null;
    petCount: number;
    byQuality: Record<string, number>;
    unknownPets: string[];
  };
  pets: RosterPet[];
  /** Slayer at the selected location (bonus goal). */
  slayer: {
    level: number;
    /** Highest enemy level here: slayer level ≥ this makes you eligible for every slayer task here. */
    zoneMaxLevel: number;
    /** Slayer damage % per mob here (rank effects). */
    perEnemy: { id: number; name: string; pct: number }[];
    avgPct: number;
    minPct: number;
  };
  pets_hidden: boolean;
  /** Next best moves, best first (setup first). */
  moves: Move[];
  /** RSVP for the next wave: their answer and what it counts as. */
  rsvp: { answer: RsvpStatus | null; effective: EffectiveRsvp };
  /** auto = always in · opt_in = chooses per assault · none = not assaulting (staff-set). */
  participation: Participation;
  key_source: string | null;
  last_sync: string | null;
  last_error: string | null;
  owner_user_id: string | null;
  has_combat_profile: boolean;
}

export interface Roster {
  guild: { id: string; name: string; nickname: string | null };
  zone: { id: number | null; name: string | null; enemyCount: number; isTracked: boolean };
  /** Next scheduled wave and who's coming. */
  nextWave: { unix: number; counts: Record<EffectiveRsvp, number> } | null;
  /** Assault locations to switch between (ids 1–10). */
  zones: { id: number; name: string; minLevel: number; maxLevel: number }[];
  trackedZoneId: number | null;
  rows: RosterRow[];
  generatedAt: string;
}

interface SnapPet {
  name: string;
  species: string | null;
  image_url: string | null;
  level: number;
  quality: string | null;
  equipped?: boolean;
  evolution?: number;
}

const lvl = (skills: Record<string, { level?: number }> | null | undefined, key: string) =>
  typeof skills?.[key]?.level === 'number' ? (skills[key].level as number) : null;

type Enemy = { id: number; name: string; level: number; health: number };

const scaleRange = (cl: number) => (cl >= 100 ? { allowed: true, max: 150, fixed: false } : cl >= 80 ? { allowed: true, max: cl, fixed: true } : { allowed: false, max: 0, fixed: false });

/** Same rule as /combat: scaled mobs use the calibrated HP curve (citadel mobs have their own). */
const resolveAt = (e: Enemy, scaled: number | null) => {
  const level = scaled && scaled > e.level ? scaled : e.level;
  return { level, hp: level === e.level ? e.health : estimateHP(HP_TARGETS[e.name] ? e.name : 'Standard Mob', level) };
};

function hitsAt(f: FighterStats, enemies: Enemy[], slayer: Record<number, number>, scaled: number | null) {
  return enemies.map((e) => matchup(f, resolveAt(e, scaled), slayer[e.id] ?? 0));
}

function max2HitLevel(
  f: FighterStats, enemies: Enemy[], slayer: Record<number, number>, scaleMax: number, canScale: boolean, fixed = false
): number | null {
  const allTwo = (L: number | null) => hitsAt(f, enemies, slayer, L).every((m) => m.hits != null && m.hits <= 2);
  if (!enemies.length || !allTwo(null)) return null;
  const base = Math.max(...enemies.map((e) => e.level));
  if (!canScale || scaleMax <= base) return base;
  // CL 80–99: scaling is all-or-nothing at your own CL.
  if (fixed) return allTwo(scaleMax) ? scaleMax : base;
  let lo = base;
  let hi = scaleMax;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (allTwo(mid)) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export async function buildRoster(
  guildId: string,
  supabase: SupabaseClient = createAdminClient(),
  zoneOverride?: number | null
): Promise<Roster | null> {
  await ensureCustomPets();
  const [{ data: guild }, { data: snaps }, { data: config }, { data: goalRow }, { data: market }] = await Promise.all([
    supabase.from('guilds').select('id, name, nickname, is_assault').eq('id', guildId).maybeSingle(),
    supabase.from('assault_roster').select('*').eq('guild_id', guildId),
    supabase.from('assault_configs').select('tracked_zone_id, zone_name').eq('guild_id', guildId).maybeSingle(),
    supabase.from('assault_roster_goals').select('goals').eq('guild_id', guildId).maybeSingle(),
    supabase.from('market_cache').select('item_name, price, price_source'),
  ]);
  const goals: GoalSet = mergeGoals(goalRow?.goals);
  const waveUnix = await nextWaveUnix(guildId);
  const answers = waveUnix ? await rsvpsForWave(guildId, waveUnix, supabase) : new Map<string, RsvpStatus>();
  // Only trust prices from real sales or market history: a vendor fallback can be a fraction of what
  // rare items sell for (Divinity: 3M vendor vs 60M+ real), so those are never suggested as buys.
  const priceByName = new Map(
    (market ?? [])
      .filter((m) => (m.price ?? 0) > 0 && (m.price_source === 'sales' || m.price_source === 'history'))
      .map((m) => [String(m.item_name).toLowerCase(), m.price as number])
  );
  const priceOf = (name: string) => priceByName.get(name.toLowerCase()) ?? null;
  if (!guild || !guild.is_assault) return null;
  const rows = snaps ?? [];
  const memberIds = rows.map((r) => r.member_id as string);
  const hashed = rows.map((r) => r.hashed_id as string);
  const trackedZoneId = (config?.tracked_zone_id as number | null) ?? null;
  const zoneId = zoneOverride && zoneOverride >= 1 && zoneOverride <= MAX_LOCATION_ID ? zoneOverride : trackedZoneId;

  const [{ data: members }, { data: profiles }, { data: potions }, { data: enemies }, locks, { data: xpPotions }] = await Promise.all([
    memberIds.length ? supabase.from('members').select('id, position, hunting_bow').in('id', memberIds) : Promise.resolve({ data: [] }),
    hashed.length
      ? supabase.from('combat_profiles').select('hashed_id, user_id, gear, settings, updated_at').in('hashed_id', hashed).order('updated_at', { ascending: false })
      : Promise.resolve({ data: [] }),
    supabase.from('combat_potions').select('id, name, quality, is_tradeable, attack_power_bonus, protection_bonus, duration_minutes, market_price, avg_recent_sales, image_url'),
    supabase.from('combat_enemies').select('id, name, level, health, zone_id, zone_name').gte('zone_id', 1).lte('zone_id', MAX_LOCATION_ID),
    getAllClaimLocks(supabase),
    supabase.from('xp_potions').select('id, name, category, xp_value, efficiency_value, image_url, market_price'),
  ]);

  const positionOf = new Map((members ?? []).map((m) => [m.id as string, (m.position as string) ?? null]));
  const bowOf = new Map((members ?? []).map((m) => [m.id as string, ((m as { hunting_bow?: string | null }).hunting_bow as string) ?? null]));
  const profileOf = new Map<string, { user_id: string; gear: GearSelection[]; settings: Record<string, unknown> }>();
  for (const p of profiles ?? []) if (!profileOf.has(p.hashed_id)) profileOf.set(p.hashed_id, p as never);

  // Whole catalog: owned gear for stats, the rest for "next best move" gear swaps.
  const { data: gearRows } = await supabase
    .from('gear_items')
    .select('id, name, slot, quality, agility, accuracy, protection, attack_power, critical_damage, combat_level, tier_modifiers, image_url, max_tier');
  const gearCatalog = new Map<number, GearItem>((gearRows ?? []).map((g) => [g.id as number, g as GearItem]));
  const potionById = new Map<number, PotionRow>((potions ?? []).map((p) => [p.id as number, p as PotionRow]));
  const xpById = new Map((xpPotions ?? []).map((p) => [p.id as number, p as { id: number; name: string; category: 'battle_xp' | 'combat_xp'; xp_value: number; efficiency_value: number; image_url: string | null }]));
  const potionsOf = (l: { ids: number[]; xpIds: number[] }): RosterPotion[] => {
    const out: RosterPotion[] = [];
    for (const id of l.ids) {
      const p = potionById.get(id);
      if (!p) continue;
      const slot = p.attack_power_bonus > 0 && p.protection_bonus > 0 ? 'combo' : p.attack_power_bonus > 0 ? 'attack' : 'protection';
      const effect = slot === 'combo' ? `+${p.attack_power_bonus}/${p.protection_bonus}%` : slot === 'attack' ? `+${p.attack_power_bonus}% AP` : `+${p.protection_bonus}% Prot`;
      out.push({ id, name: p.name, image_url: p.image_url, slot, effect });
    }
    for (const id of l.xpIds) {
      const p = xpById.get(id);
      if (!p) continue;
      const label = p.category === 'battle_xp' ? 'Battle XP' : 'Combat XP';
      const effect = p.xp_value ? `+${p.xp_value}% ${label}` : p.efficiency_value ? `+${p.efficiency_value}% eff` : label;
      out.push({ id, name: p.name, image_url: p.image_url, slot: p.category, effect });
    }
    const order = ['combo', 'attack', 'protection', 'battle_xp', 'combat_xp'];
    return out.sort((a, b) => order.indexOf(a.slot) - order.indexOf(b.slot));
  };
  // Loadout strength: AP %, Prot %, Battle XP %, Combat XP % (efficiency potions don't stack, take the best).
  const vectorOf = (l: { ids: number[]; xpIds: number[] }) => {
    let ap = 0, prot = 0, bxp = 0, cxp = 0;
    for (const id of l.ids) { const p = potionById.get(id); if (p) { ap += p.attack_power_bonus; prot += p.protection_bonus; } }
    for (const id of l.xpIds) { const p = xpById.get(id); if (!p) continue; if (p.category === 'battle_xp') bxp = Math.max(bxp, p.xp_value); else cxp = Math.max(cxp, p.xp_value); }
    return [ap, prot, bxp, cxp];
  };
  const potionTierOf = (l: { ids: number[]; xpIds: number[] }) => {
    const v = vectorOf(l);
    let tier = 0;
    for (const p of presetRows ?? []) {
      const t = Number((p as { assault_tier?: number }).assault_tier ?? 0);
      if (!t) continue;
      const pv = vectorOf({ ids: p.combat_potion_ids ?? [], xpIds: p.xp_potion_ids ?? [] });
      if (v.every((x, i) => x >= pv[i])) tier = Math.max(tier, t);
    }
    return tier;
  };

  // Default potion loadout per owner (web default beats Discord, like /combat).
  const ownerOf = (memberId: string) => {
    const l = locks.get(memberId);
    return l?.status === 'approved' ? l.user_id : null;
  };
  const owners = Array.from(new Set(memberIds.map(ownerOf).filter(Boolean))) as string[];
  const loadoutOf = new Map<string, { name: string; ids: number[]; xpIds: number[] }>();
  const { data: presetRows } = await supabase.from('assault_potion_presets').select('*').order('sort_order');
  const key = (ids: number[]) => [...ids].sort((a, b) => a - b).join(',');
  const presetOf = (l: { ids: number[]; xpIds: number[] }) => {
    const p = (presetRows ?? []).find((x) => key(x.combat_potion_ids ?? []) === key(l.ids) && key(x.xp_potion_ids ?? []) === key(l.xpIds));
    return p ? { id: p.id as string, label: p.label as string, recommended: p.id === RECOMMENDED_PRESET_ID } : null;
  };
  if (owners.length) {
    const { data: links } = await supabase.from('user_discord_links').select('user_id, discord_id').in('user_id', owners);
    const discordToUser = new Map((links ?? []).map((l) => [l.discord_id as string, l.user_id as string]));
    const { data: loadouts } = await supabase
      .from('assault_potion_loadouts')
      .select('name, combat_potion_ids, xp_potion_ids, user_id, discord_user_id')
      .eq('is_default', true);
    for (const l of loadouts ?? []) {
      const viaWeb = l.user_id && owners.includes(l.user_id) ? (l.user_id as string) : null;
      const viaDiscord = l.discord_user_id ? discordToUser.get(l.discord_user_id as string) ?? null : null;
      const uid = viaWeb ?? viaDiscord;
      if (!uid || (loadoutOf.has(uid) && !viaWeb)) continue;
      loadoutOf.set(uid, { name: l.name as string, ids: (l.combat_potion_ids ?? []) as number[], xpIds: (l.xp_potion_ids ?? []) as number[] });
    }
  }

  const allEnemies = (enemies ?? []) as (Enemy & { zone_id: number; zone_name: string })[];
  const zoneEnemies: Enemy[] = allEnemies.filter((e) => e.zone_id === zoneId);
  const zoneMap = new Map<number, { id: number; name: string; minLevel: number; maxLevel: number }>();
  for (const e of allEnemies) {
    const z = zoneMap.get(e.zone_id) ?? { id: e.zone_id, name: e.zone_name, minLevel: e.level, maxLevel: e.level };
    z.minLevel = Math.min(z.minLevel, e.level);
    z.maxLevel = Math.max(z.maxLevel, e.level);
    zoneMap.set(e.zone_id, z);
  }
  const zones = Array.from(zoneMap.values()).sort((a, b) => a.minLevel - b.minLevel);
  const minPetLevel = zoneEnemies.length ? Math.min(...zoneEnemies.map((e) => e.level)) : 1;

  const out: RosterRow[] = rows.map((r) => {
    const skills = r.skills as Record<string, { level?: number }> | null;
    const pm = lvl(skills, 'pet-mastery') ?? 0;
    const pets: SnapPet[] = (r.pets ?? []) as SnapPet[];
    const resolved = pets.map((p) => ({ ...p, species: p.species ?? resolveSpeciesName(p.name, p.image_url) }));
    // Pets below the location's lowest enemy level can't hunt there (user rule).
    const squad = squadHuntPower(
      resolved.filter((p) => p.level >= minPetLevel).map((p) => ({ species: p.species, level: p.level, evolution: p.evolution ?? 0 })),
      pm,
      HUNT_STABLE_SIZE
    );
    const squadTop = new Map<string, number>();
    for (const s of squad.squad) squadTop.set(`${s.species}:${s.level}`, (squadTop.get(`${s.species}:${s.level}`) ?? 0) + 1);

    const petRows: RosterPet[] = [];
    for (const p of resolved) {
      const est = p.species ? petHuntEstimate(p.species, p.level, pm, p.evolution ?? 0) : null;
      if (!est) continue;
      const k = `${est.species}:${est.level}`;
      const inSquad = (squadTop.get(k) ?? 0) > 0;
      const eligible = est.level >= minPetLevel;
      const counted = eligible && inSquad;
      if (counted) squadTop.set(k, (squadTop.get(k) ?? 0) - 1);
      petRows.push({ ...est, name: p.name, tier: petTier(est.species) ?? est.quality, evolution: p.evolution ?? 0, equipped: !!p.equipped, inSquad: counted, eligible });
    }
    petRows.sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.citadelEncounters - a.citadelEncounters);

    const byQuality: Record<string, number> = {};
    for (const p of petRows) byQuality[p.tier] = (byQuality[p.tier] ?? 0) + 1;

    const ep = r.equipped_pet as { species: string | null; name: string; image_url: string | null; level: number; evolution?: number; quality?: string } | null;
    const epSpecies = ep ? ep.species ?? resolveSpeciesName(ep.name, ep.image_url) : null;

    // Battle: best pet among everything owned, evaluated on the selected zone.
    const profile = profileOf.get(r.hashed_id);
    const owner = ownerOf(r.member_id);
    const loadout = owner ? loadoutOf.get(owner) ?? null : null;
    const gearSet = !!profile && (profile.gear ?? []).length > 0;
    const cl = lvl(skills, 'combat') ?? 0;
    const scale = scaleRange(cl);
    const slayer = slayerByEnemy(r.effects as ApiEffect[]);
    const buffs: BuffState = loadout ? withPotions(NO_BUFFS, loadout.ids, potionById) : NO_BUFFS;
    const patted = profile?.settings?.petPatted !== false; // assault-ready: battle pet patted (5Ps)
    const fighterWith = (pet: { species: string; level: number; evolution: number } | null, gearOverride?: GearSelection[]) => {
      const char = buildCharacterStats({
        stats: r.stats as StatLevels | null,
        skills: skills as Record<string, { level: number }> | null,
        characterClass: r.character_class,
        pet: pet ? { species: pet.species, level: pet.level, mastery: pm, patted, evolution: pet.evolution } : null,
        gear: gearOverride ?? (gearSet ? profile!.gear : []),
        gearCatalog,
        manual: ZERO_STATS,
      });
      const b = applyBuffs(char, buffs);
      return { ...b, critChance: char.critChance.total, critDamage: char.critDamage.total, damageFlat: char.damageFlat.total } as FighterStats;
    };

    const candidates = new Map<string, { species: string; level: number; evolution: number; equipped: boolean }>();
    for (const p of resolved) {
      if (!p.species || !PET_STATS[p.species]) continue;
      const key = `${p.species}:${p.level}:${p.evolution ?? 0}`;
      if (!candidates.has(key) || p.equipped) candidates.set(key, { species: p.species, level: p.level, evolution: p.evolution ?? 0, equipped: !!p.equipped });
    }
    if (epSpecies && PET_STATS[epSpecies]) {
      const key = `${epSpecies}:${ep!.level}:${ep!.evolution ?? 0}`;
      candidates.set(key, { species: epSpecies, level: ep!.level, evolution: ep!.evolution ?? 0, equipped: true });
    }

    let bestPet: RosterRow['battle']['bestPet'] = null;
    let bestFighter: FighterStats | null = null;
    if (zoneEnemies.length) {
      // Rank by total hits on the zone, then damage; the top few also by 2-hit scaling headroom.
      const ranked = Array.from(candidates.values())
        .map((c) => {
          const f = fighterWith(c);
          const ms = hitsAt(f, zoneEnemies, slayer, null);
          return { c, f, hits: ms.reduce((t, m) => t + (m.hits ?? 99), 0), dmg: ms.reduce((t, m) => t + m.damage, 0) };
        })
        .sort((a, b) => a.hits - b.hits || b.dmg - a.dmg)
        .slice(0, 4)
        .map((x) => ({ ...x, two: max2HitLevel(x.f, zoneEnemies, slayer, scale.max, scale.allowed, scale.fixed) ?? 0 }))
        .sort((a, b) => a.hits - b.hits || b.two - a.two || b.dmg - a.dmg);
      if (ranked[0]) {
        bestPet = { ...ranked[0].c, tier: petTier(ranked[0].c.species) };
        bestFighter = ranked[0].f;
      }
    } else if (candidates.size) {
      // No zone to test against: strongest by raw damage-relevant stats.
      const top = Array.from(candidates.values())
        .map((c) => ({ c, f: fighterWith(c) }))
        .sort((a, b) => b.f.attackPower + b.f.accuracy - (a.f.attackPower + a.f.accuracy))[0];
      bestPet = { ...top.c, tier: petTier(top.c.species) };
      bestFighter = top.f;
    }

    const computed = gearSet && zoneEnemies.length > 0 && !!bestFighter;
    const fighter = bestFighter ?? fighterWith(null);
    const enemyHits = computed
      ? zoneEnemies
          .map((e) => ({ id: e.id, name: e.name, level: e.level, hits: matchup(fighter, { level: e.level, hp: e.health }, slayer[e.id] ?? 0).hits }))
          .sort((a, b) => (a.hits ?? 99) - (b.hits ?? 99) || a.level - b.level)
      : [];
    const distMap = new Map<number, number>();
    for (const e of enemyHits) if (e.hits != null) distMap.set(e.hits, (distMap.get(e.hits) ?? 0) + 1);
    const dist = Array.from(distMap.entries()).sort((a, b) => a[0] - b[0]).map(([hits, count]) => ({ hits, count }));
    const worstHits = enemyHits.length ? Math.max(...enemyHits.map((e) => e.hits ?? 99)) : null;

    // Cheapest single gear swap (bought at tier 1) that reaches the next battle tier.
    let upgrade: RosterRow['battle']['upgrade'] = null;
    const canPick = scale.allowed && !scale.fixed;
    const curMax2 = computed ? max2HitLevel(fighter, zoneEnemies, slayer, scale.max, scale.allowed, scale.fixed) : null;
    if (computed && hasMarketAccess(r.character_class)) {
      const curTier = battleTier(enemyHits.map((e) => e.hits ?? 99), canPick, curMax2, goals);
      if (curTier < 5 && !(curTier >= 3 && !canPick)) {
        const pet = bestPet ? { species: bestPet.species, level: bestPet.level, evolution: bestPet.evolution } : null;
        const owned = new Set(profile!.gear.map((g) => g.gear_item_id));
        for (const item of Array.from(gearCatalog.values())) {
          if (item.combat_level > cl || owned.has(item.id)) continue;
          const price = priceOf(item.name);
          if (!price || (upgrade && price >= upgrade.price)) continue;
          const clears = new Set([item.slot, ...(HAND_SLOT_CONFLICTS[item.slot] ?? [])]);
          const gear = [...profile!.gear.filter((g) => !clears.has(g.slot)), { slot: item.slot, gear_item_id: item.id, tier: 1 }];
          const f = fighterWith(pet, gear);
          const hs = hitsAt(f, zoneEnemies, slayer, null).map((m) => m.hits ?? 99);
          const m2 = Math.max(...hs) <= 2 ? max2HitLevel(f, zoneEnemies, slayer, scale.max, scale.allowed, scale.fixed) : null;
          const t = battleTier(hs, canPick, m2, goals);
          if (t > curTier) upgrade = { item: item.name, slot: item.slot, price, toTier: t };
        }
      }
    }

    const best = squad.squad[0];
    return {
      member_id: r.member_id,
      ign: r.ign,
      character_class: r.character_class,
      image_url: r.image_url,
      position: positionOf.get(r.member_id) ?? null,
      combat_level: lvl(skills, 'combat'),
      hunting_mastery: lvl(skills, 'hunting-mastery'),
      pet_mastery: lvl(skills, 'pet-mastery'),
      dexterity: (r.stats as StatLevels | null)?.dexterity?.level ?? null,
      equipped_pet: ep ? { species: epSpecies, level: ep.level, evolution: ep.evolution ?? 0, tier: petTier(epSpecies) } : null,
      battle: {
        gearSet,
        loadout: loadout?.name ?? null,
        loadoutPotions: loadout ? potionsOf(loadout) : [],
        preset: loadout ? presetOf(loadout) : null,
        potionTier: loadout ? potionTierOf(loadout) : 0,
        bestPet,
        computed,
        stats: computed
          ? { attackPower: fighter.attackPower, protection: fighter.protection, agility: fighter.agility, accuracy: fighter.accuracy, critChance: fighter.critChance, critDamage: fighter.critDamage }
          : null,
        enemies: enemyHits,
        dist,
        worstHits: worstHits === 99 ? null : worstHits,
        canScale: scale.allowed,
        scaleMax: scale.max,
        scaleFixed: scale.fixed,
        max2HitLevel: curMax2,
        upgrade,
      },
      hunting: {
        bow: huntingBow(bowOf.get(r.member_id)),
        squadSize: petSquadSize(pm),
        stableSize: HUNT_STABLE_SIZE,
        minPetLevel,
        eligibleCount: petRows.filter((p) => p.eligible).length,
        squadPower: squad.power,
        bestPet: best ? { species: best.species, level: best.level, citadelEncounters: best.citadelEncounters } : null,
        petCount: pets.length,
        byQuality,
        unknownPets: Array.from(new Set(resolved.filter((p) => !p.species).map((p) => p.name))),
      },
      pets: petRows,
      slayer: (() => {
        const perEnemy = zoneEnemies.map((e) => ({ id: e.id, name: e.name, pct: slayer[e.id] ?? 0 }));
        const pcts = perEnemy.map((e) => e.pct);
        return {
          level: lvl(skills, 'slayer') ?? 0,
          zoneMaxLevel: zoneEnemies.length ? Math.max(...zoneEnemies.map((e) => e.level)) : 0,
          perEnemy,
          avgPct: pcts.length ? Math.round((pcts.reduce((a, b) => a + b, 0) / pcts.length) * 10) / 10 : 0,
          minPct: pcts.length ? Math.min(...pcts) : 0,
        };
      })(),
      pets_hidden: !!r.pets_hidden,
      moves: [] as Move[],
      rsvp: (() => {
        const part = (PARTICIPATION.includes(r.participation) ? r.participation : 'auto') as Participation;
        const answer = answers.get(r.member_id) ?? null;
        return { answer, effective: effectiveRsvp(part, answer) };
      })(),
      participation: (PARTICIPATION.includes(r.participation) ? r.participation : 'auto') as Participation,
      key_source: r.key_source ?? null,
      last_sync: r.last_sync ?? null,
      last_error: r.last_error ?? null,
      owner_user_id: owner,
      has_combat_profile: !!profile,
    };
  });

  // Next best moves need the finished rows (goals evaluate on them).
  const presetCost = (p: { combat_potion_ids?: number[]; xp_potion_ids?: number[] }) => {
    let total = 0;
    let unknown = false;
    for (const id of p.combat_potion_ids ?? []) {
      const c = potionById.get(id);
      if (!c || !c.is_tradeable) continue;
      if (c.market_price == null) unknown = true; else total += c.market_price;
    }
    for (const id of p.xp_potion_ids ?? []) {
      const x = xpById.get(id) as { market_price?: number | null } | undefined;
      if (!x) continue;
      if (x.market_price == null) unknown = true; else total += x.market_price;
    }
    return unknown && !total ? null : total;
  };
  const tieredPresets = (presetRows ?? [])
    .filter((p) => Number((p as { assault_tier?: number }).assault_tier ?? 0) > 0)
    .map((p) => ({ id: p.id as string, label: p.label as string, tier: Number((p as { assault_tier?: number }).assault_tier), cost: presetCost(p) }));
  for (const row of out) {
    row.moves = computeMoves(row, { goals, price: priceOf, presets: tieredPresets, marketAccess: hasMarketAccess(row.character_class) }).slice(0, 6);
  }

  const pOrder = (p: Participation) => PARTICIPATION.indexOf(p);
  out.sort((a, b) => pOrder(a.participation) - pOrder(b.participation) || (b.combat_level ?? 0) - (a.combat_level ?? 0) || b.hunting.squadPower - a.hunting.squadPower);

  return {
    guild: { id: String(guild.id), name: guild.name, nickname: guild.nickname ?? null },
    zone: { id: zoneId, name: zoneMap.get(zoneId ?? -1)?.name ?? (config?.zone_name as string) ?? null, enemyCount: zoneEnemies.length, isTracked: zoneId === trackedZoneId },
    zones,
    trackedZoneId,
    nextWave: waveUnix
      ? {
          unix: waveUnix,
          counts: out.reduce(
            (c, r) => ({ ...c, [r.rsvp.effective]: (c[r.rsvp.effective] ?? 0) + 1 }),
            { in: 0, maybe: 0, out: 0, no_reply: 0, none: 0 } as Record<EffectiveRsvp, number>
          ),
        }
      : null,
    rows: out,
    generatedAt: new Date().toISOString(),
  };
}
