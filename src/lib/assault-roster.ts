/**
 * Assault Roster read model (docs/assault-roster.md §2): what every assaulter in a guild runs
 * for battle and hunting, built from `assault_roster` snapshots plus /combat profiles,
 * default potion loadouts and the guild's tracked assault zone.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase-server';
import { getAccountCharacters, getAllClaimLocks } from '@/lib/account-service';
import { RANK, outranks, outrankError, rankInGuild, rankOfUser } from '@/lib/role-hierarchy';
import { SUPER_ADMIN_EMAIL } from '@/lib/auth-helpers';
import { ensureCustomPets } from '@/lib/combat/custom-pets-server';
import { resolveSpeciesName, petTier, PET_STATS } from '@/lib/combat/pet-data';
import { petHuntEstimate, squadHuntPower, petSquadSize, HUNT_STABLE_SIZE, type PetHuntEstimate } from '@/lib/combat/pet-hunting';
import { huntingBow, PET_EGGS, type HuntingBow } from '@/lib/combat/hunting-gear';
import {
  applyBuffs, buildCharacterStats, slayerByEnemy, NO_BUFFS, ZERO_STATS,
  type ApiEffect, type BuffState, type GearItem, type GearSelection, type StatLevels,
} from '@/lib/combat/character-stats';
import { matchup, estimateHP, HP_TARGETS, type FighterStats } from '@/lib/combat/formulas';
import { MAX_LOCATION_ID } from '@/lib/assault-plan';
import { RECOMMENDED_PRESET_ID } from '@/lib/potion-rules';
import { battleTier, mergeGoals, type GoalSet } from '@/lib/roster-goals';
import { bowOptions, computeMoves, huntEggOptions, priceBattleOptions, stableAtL100, type BowOption, type BattleSpeciesOption, type EggOption, type Move } from '@/lib/roster-moves';
import { hasMarketAccess } from '@/lib/combat/class-talents';
import { effectiveRsvp, nextWaveUnix, rsvpsForWave, type EffectiveRsvp, type RsvpStatus } from '@/lib/assault-rsvp';
import { GEAR_SLOTS, HAND_SLOT_CONFLICTS } from '@/lib/combat/character-stats';
import { withPotions } from '@/app/combat/potion-slots';
import type { PotionRow } from '@/app/combat/types';

const GEAR_SLOT_ORDER: string[] = GEAR_SLOTS.map((s) => s.key);

/* ─── access ─── */

/**
 * Leader edits on a roster character (gear, provisional potion preset): leaders (and super admin)
 * of that assault guild, only for owners ranked below them (staff hierarchy rule), unclaimed
 * characters, or their own.
 */
export async function canLeaderEditMember(
  supabase: SupabaseClient,
  user: { id: string; email?: string },
  guildId: string,
  ownerUserId: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await rankInGuild(supabase, user, guildId);
  if (actor < RANK.LEADER) return { ok: false, error: 'Only guild leaders can change this' };
  if (!ownerUserId || ownerUserId === user.id) return { ok: true };
  const target = await rankOfUser(supabase, ownerUserId, guildId);
  if (!outranks(actor, target)) return { ok: false, error: outrankError(actor, target, 'change setups for') };
  return { ok: true };
}


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
    /** own = their saved default · provisional = preset a leader picked · default = the Mid preset (nothing set yet). */
    loadoutSource: LoadoutSource;
    /** Preset id a leader set as provisional (only used while they have no own loadout). */
    provisionalPreset: string | null;
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
    /** Best battle species per buyable quality (Epic, Legendary) at L100 for this character, best first:
     *  fewest hits, then 2-hit scaling level (CL 100+), then most damage, then least damage taken. */
    bestSpecies: Record<'Epic' | 'Legendary', string[]>;
    /** Every buyable Epic / Legendary species (and one generic Mythic row) simulated at L100 here,
     *  strongest first per quality. Prices filled in with the moves. Feeds the "weigh options" view. */
    speciesOptions: BattleSpeciesOption[];
    /** Cheapest single gear swap (base tier, market price) that reaches the next battle tier. */
    upgrade: { item: string; slot: string; price: number; toTier: number } | null;
    /** Recruiter check only (ctx.planMinGear): a cheap gear set (tier 1) that gets Battle to Bronze. */
    minGear?: MinGearPlan;
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
    /** Encounters of the best 20 own pets if levelled to L100 (for egg planning). */
    stableL100: number[];
    /** Buyable eggs with encounters at L100 for this member's pet mastery and price (filled with the moves). */
    eggOptions: EggOption[];
    /** Every hunting bow with price and this character's missing requirement (filled with the moves). */
    bowOptions: BowOption[];
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
  /** Discord account known for this character (members.discord_id or the owner's linked Discord). */
  discord_linked: boolean;
  /** Gear saved on /combat (same data the hits use), in slot order. */
  gear: RosterGear[];
  /** Gear came from a leader edit stored on the roster (no /combat profile yet). */
  gear_from_staff: boolean;
}

export type LoadoutSource = 'own' | 'provisional' | 'default';

export interface RosterGear {
  slot: string;
  gear_item_id: number;
  tier: number;
  name: string;
  quality: string;
  image_url: string | null;
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

/* ─── row building (shared by the roster and /assault/eligibility) ─── */

/** One character's API snapshot: an `assault_roster` row or an `assault_eligibility_snapshots` row. */
export interface RosterSnapshot {
  member_id: string;
  hashed_id: string;
  ign: string;
  character_class: string | null;
  image_url: string | null;
  skills: unknown;
  stats: unknown;
  effects: unknown;
  pets: unknown;
  equipped_pet: unknown;
  pets_hidden?: boolean | null;
  /** Roster only; eligibility rows default to auto. */
  participation?: string | null;
  provisional_preset?: string | null;
  staff_gear?: unknown;
  key_source?: string | null;
  last_sync?: string | null;
  last_error?: string | null;
}

type ZoneEnemy = Enemy & { zone_id: number; zone_name: string };
type XpPotion = { id: number; name: string; category: 'battle_xp' | 'combat_xp'; xp_value: number; efficiency_value: number; image_url: string | null; market_price?: number | null };
type PresetRow = { id: string; label: string; combat_potion_ids: number[] | null; xp_potion_ids: number[] | null; assault_tier?: number | null };
type Loadout = { name: string; ids: number[]; xpIds: number[] };
export type TieredPreset = { id: string; label: string; tier: number; cost: number | null };

/** Guild-independent data every row needs: catalogs, potion presets, trusted prices, assault zones. */
export interface RowCatalog {
  gearCatalog: Map<number, GearItem>;
  potionById: Map<number, PotionRow>;
  xpById: Map<number, XpPotion>;
  presetRows: PresetRow[];
  tieredPresets: TieredPreset[];
  priceOf: (name: string) => number | null;
  allEnemies: ZoneEnemy[];
  zones: { id: number; name: string; minLevel: number; maxLevel: number }[];
}

/** Per-character lookups: member fields, /combat profiles, owners, default loadouts, Discord links. */
export interface RowMembers {
  memberInfo: Map<string, { position: string | null; hunting_bow: string | null; discord_id: string | null }>;
  profileOf: Map<string, { user_id: string; gear: GearSelection[]; settings: Record<string, unknown> }>;
  ownerOf: (memberId: string) => string | null;
  loadoutOf: Map<string, Loadout>;
  discordOwners: Set<string>;
}

/** What the row is measured against: a guild's goals at one assault zone. */
export interface RowZone {
  goals: GoalSet;
  zoneEnemies: Enemy[];
  minPetLevel: number;
}

export type RosterRowContext = RowCatalog & RowMembers & RowZone & {
  /** RSVP answers for the next wave (roster only). */
  answers: Map<string, RsvpStatus>;
  /** Plan the cheapest gear set that reaches Battle Bronze (recruiter check; costs a few ms). */
  planMinGear?: boolean;
};

export interface MinGearPlan {
  /** False: even the best gear we can price doesn't get every mob to 4 hits or fewer. */
  reachable: boolean;
  items: { slot: string; item_id: number; name: string; quality: string; combat_level: number; price: number | null }[];
  /** Sum of known prices (tier 1, recent market sales). */
  total: number;
  /** Worst hits on the zone with this set. */
  worstHits: number | null;
}

export async function loadRowCatalog(supabase: SupabaseClient = createAdminClient()): Promise<RowCatalog> {
  await ensureCustomPets();
  const [{ data: market }, { data: potions }, { data: enemies }, { data: xpPotions }, { data: gearRows }, { data: presets }] = await Promise.all([
    supabase.from('market_cache').select('item_name, price, price_source'),
    supabase.from('combat_potions').select('id, name, quality, is_tradeable, attack_power_bonus, protection_bonus, duration_minutes, market_price, avg_recent_sales, image_url'),
    supabase.from('combat_enemies').select('id, name, level, health, zone_id, zone_name').gte('zone_id', 1).lte('zone_id', MAX_LOCATION_ID),
    supabase.from('xp_potions').select('id, name, category, xp_value, efficiency_value, image_url, market_price'),
    // Whole catalog: owned gear for stats, the rest for "next best move" gear swaps.
    supabase
      .from('gear_items')
      .select('id, name, slot, quality, agility, accuracy, protection, attack_power, critical_damage, combat_level, tier_modifiers, image_url, max_tier'),
    supabase.from('assault_potion_presets').select('*').order('sort_order'),
  ]);
  // Only trust prices from real sales or market history: a vendor fallback can be a fraction of what
  // rare items sell for (Divinity: 3M vendor vs 60M+ real), so those are never suggested as buys.
  const priceByName = new Map(
    (market ?? [])
      .filter((m) => (m.price ?? 0) > 0 && (m.price_source === 'sales' || m.price_source === 'history'))
      .map((m) => [String(m.item_name).toLowerCase(), m.price as number])
  );
  const potionById = new Map<number, PotionRow>((potions ?? []).map((p) => [p.id as number, p as PotionRow]));
  const xpById = new Map((xpPotions ?? []).map((p) => [p.id as number, p as XpPotion]));
  const presetRows = (presets ?? []) as PresetRow[];

  const presetCost = (p: PresetRow) => {
    let total = 0;
    let unknown = false;
    for (const id of p.combat_potion_ids ?? []) {
      const c = potionById.get(id);
      if (!c || !c.is_tradeable) continue;
      if (c.market_price == null) unknown = true; else total += c.market_price;
    }
    for (const id of p.xp_potion_ids ?? []) {
      const x = xpById.get(id);
      if (!x) continue;
      if (x.market_price == null) unknown = true; else total += x.market_price;
    }
    return unknown && !total ? null : total;
  };
  const tieredPresets = presetRows
    .filter((p) => Number(p.assault_tier ?? 0) > 0)
    .map((p) => ({ id: p.id, label: p.label, tier: Number(p.assault_tier), cost: presetCost(p) }));

  const allEnemies = (enemies ?? []) as ZoneEnemy[];
  const zoneMap = new Map<number, { id: number; name: string; minLevel: number; maxLevel: number }>();
  for (const e of allEnemies) {
    const z = zoneMap.get(e.zone_id) ?? { id: e.zone_id, name: e.zone_name, minLevel: e.level, maxLevel: e.level };
    z.minLevel = Math.min(z.minLevel, e.level);
    z.maxLevel = Math.max(z.maxLevel, e.level);
    zoneMap.set(e.zone_id, z);
  }

  return {
    gearCatalog: new Map<number, GearItem>((gearRows ?? []).map((g) => [g.id as number, g as GearItem])),
    potionById,
    xpById,
    presetRows,
    tieredPresets,
    priceOf: (name: string) => priceByName.get(name.toLowerCase()) ?? null,
    allEnemies,
    zones: Array.from(zoneMap.values()).sort((a, b) => a.minLevel - b.minLevel),
  };
}

/** A guild's goals at one assault zone (enemies of that zone; pets must be ≥ its lowest enemy level). */
export function zoneSlice(catalog: RowCatalog, zoneId: number | null, goals: GoalSet): RowZone {
  const zoneEnemies: Enemy[] = catalog.allEnemies.filter((e) => e.zone_id === zoneId);
  return { goals, zoneEnemies, minPetLevel: zoneEnemies.length ? Math.min(...zoneEnemies.map((e) => e.level)) : 1 };
}

export async function loadRowMembers(
  supabase: SupabaseClient,
  memberIds: string[],
  hashed: string[]
): Promise<RowMembers> {
  const [{ data: members }, { data: profiles }, locks] = await Promise.all([
    memberIds.length ? supabase.from('members').select('id, position, hunting_bow, discord_id').in('id', memberIds) : Promise.resolve({ data: [] }),
    hashed.length
      ? supabase.from('combat_profiles').select('hashed_id, user_id, gear, settings, updated_at').in('hashed_id', hashed).order('updated_at', { ascending: false })
      : Promise.resolve({ data: [] }),
    getAllClaimLocks(supabase),
  ]);
  const memberInfo: RowMembers['memberInfo'] = new Map(
    ((members ?? []) as { id: string; position?: string | null; hunting_bow?: string | null; discord_id?: string | null }[]).map((m) => [
      m.id,
      { position: m.position ?? null, hunting_bow: m.hunting_bow ?? null, discord_id: m.discord_id ?? null },
    ])
  );
  const profileOf: RowMembers['profileOf'] = new Map();
  for (const p of profiles ?? []) if (!profileOf.has(p.hashed_id)) profileOf.set(p.hashed_id, p as never);

  // Default potion loadout per owner (web default beats Discord, like /combat).
  const ownerOf = (memberId: string) => {
    const l = locks.get(memberId);
    return l?.status === 'approved' ? l.user_id : null;
  };
  const owners = Array.from(new Set(memberIds.map(ownerOf).filter(Boolean))) as string[];
  const loadoutOf = new Map<string, Loadout>();
  const discordOwners = new Set<string>();
  if (owners.length) {
    const { data: links } = await supabase.from('user_discord_links').select('user_id, discord_id').in('user_id', owners);
    const discordToUser = new Map((links ?? []).map((l) => [l.discord_id as string, l.user_id as string]));
    for (const l of links ?? []) discordOwners.add(l.user_id as string);
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
  return { memberInfo, profileOf, ownerOf, loadoutOf, discordOwners };
}

function potionsOf(ctx: RowCatalog, l: Loadout): RosterPotion[] {
  const out: RosterPotion[] = [];
  for (const id of l.ids) {
    const p = ctx.potionById.get(id);
    if (!p) continue;
    const slot = p.attack_power_bonus > 0 && p.protection_bonus > 0 ? 'combo' : p.attack_power_bonus > 0 ? 'attack' : 'protection';
    const effect = slot === 'combo' ? `+${p.attack_power_bonus}/${p.protection_bonus}%` : slot === 'attack' ? `+${p.attack_power_bonus}% AP` : `+${p.protection_bonus}% Prot`;
    out.push({ id, name: p.name, image_url: p.image_url, slot, effect });
  }
  for (const id of l.xpIds) {
    const p = ctx.xpById.get(id);
    if (!p) continue;
    const label = p.category === 'battle_xp' ? 'Battle XP' : 'Combat XP';
    const effect = p.xp_value ? `+${p.xp_value}% ${label}` : p.efficiency_value ? `+${p.efficiency_value}% eff` : label;
    out.push({ id, name: p.name, image_url: p.image_url, slot: p.category, effect });
  }
  const order = ['combo', 'attack', 'protection', 'battle_xp', 'combat_xp'];
  return out.sort((a, b) => order.indexOf(a.slot) - order.indexOf(b.slot));
}

/** Loadout strength: AP %, Prot %, Battle XP %, Combat XP % (efficiency potions don't stack, take the best). */
function vectorOf(ctx: RowCatalog, l: Loadout) {
  let ap = 0, prot = 0, bxp = 0, cxp = 0;
  for (const id of l.ids) { const p = ctx.potionById.get(id); if (p) { ap += p.attack_power_bonus; prot += p.protection_bonus; } }
  for (const id of l.xpIds) { const p = ctx.xpById.get(id); if (!p) continue; if (p.category === 'battle_xp') bxp = Math.max(bxp, p.xp_value); else cxp = Math.max(cxp, p.xp_value); }
  return [ap, prot, bxp, cxp];
}

function potionTierOf(ctx: RowCatalog, l: Loadout) {
  const v = vectorOf(ctx, l);
  let tier = 0;
  for (const p of ctx.presetRows) {
    const t = Number(p.assault_tier ?? 0);
    if (!t) continue;
    const pv = vectorOf(ctx, { name: p.label, ids: p.combat_potion_ids ?? [], xpIds: p.xp_potion_ids ?? [] });
    if (v.every((x, i) => x >= pv[i])) tier = Math.max(tier, t);
  }
  return tier;
}

const idKey = (ids: number[]) => [...ids].sort((a, b) => a - b).join(',');
function presetOf(ctx: RowCatalog, l: Loadout) {
  const p = ctx.presetRows.find((x) => idKey(x.combat_potion_ids ?? []) === idKey(l.ids) && idKey(x.xp_potion_ids ?? []) === idKey(l.xpIds));
  return p ? { id: p.id, label: p.label, recommended: p.id === RECOMMENDED_PRESET_ID } : null;
}

/**
 * One character measured against one guild's goals at one zone: battle, hunting, pets, slayer and
 * the next best moves. The roster and /assault/eligibility both use this, so the maths is identical.
 */
export function buildRosterRow(r: RosterSnapshot, ctx: RosterRowContext): RosterRow {
  const { goals, zoneEnemies, minPetLevel, gearCatalog, potionById, presetRows, priceOf } = ctx;
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
  const profile = ctx.profileOf.get(r.hashed_id);
  const owner = ctx.ownerOf(r.member_id);
  // Loadout: their own default, else a leader's provisional preset, else the Mid preset (user rule).
  const ownLoadout = owner ? ctx.loadoutOf.get(owner) ?? null : null;
  const provisionalId = r.provisional_preset ?? null;
  const fallbackPreset = presetRows.find((p) => p.id === provisionalId) ?? presetRows.find((p) => p.id === RECOMMENDED_PRESET_ID);
  const loadoutSource: LoadoutSource = ownLoadout ? 'own' : fallbackPreset && fallbackPreset.id === provisionalId ? 'provisional' : 'default';
  const loadout: Loadout | null = ownLoadout ?? (fallbackPreset
    ? { name: fallbackPreset.label, ids: fallbackPreset.combat_potion_ids ?? [], xpIds: fallbackPreset.xp_potion_ids ?? [] }
    : null);
  // Gear: /combat profile, else what a leader saved on the roster for an unclaimed character.
  const profileGear: GearSelection[] = profile?.gear ?? [];
  const staffGear: GearSelection[] = Array.isArray(r.staff_gear) ? (r.staff_gear as GearSelection[]) : [];
  const gear: GearSelection[] = profileGear.length ? profileGear : staffGear;
  // Saved with nothing equipped (settings.noGear) counts as set: battle is measured without gear.
  const gearSet = gear.length > 0 || (profileGear.length === 0 && profile?.settings?.noGear === true);
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
      gear: gearOverride ?? gear,
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

  // Species to buy, judged for battling here at L100 (user rule): fewest hits, then (CL 100+) the
  // highest level they still 2-hit everything at, then MOST DAMAGE, then least damage taken.
  // Mythic eggs hatch a random Mythic: one generic row, worst case. Hits at each mob's own level.
  const bestSpecies: Record<'Epic' | 'Legendary', string[]> = { Epic: [], Legendary: [] };
  const speciesOptions: BattleSpeciesOption[] = [];
  if (zoneEnemies.length) {
    const simulate = (name: string) => {
      const f = fighterWith({ species: name, level: 100, evolution: 0 });
      const ms = hitsAt(f, zoneEnemies, slayer, null);
      const counts = new Map<number, number>();
      for (const m of ms) counts.set(m.hits ?? 99, (counts.get(m.hits ?? 99) ?? 0) + 1);
      return {
        hits: ms.reduce((t, m) => t + (m.hits ?? 99), 0),
        dist: Array.from(counts.entries()).sort((a, b) => a[0] - b[0]).map(([h, c]) => `${c}×${h}`).join(' · '),
        perMob: ms.map((m) => m.hits).sort((a, b) => (a ?? 99) - (b ?? 99)),
        twoHitLv: scale.allowed && !scale.fixed ? max2HitLevel(f, zoneEnemies, slayer, scale.max, scale.allowed, scale.fixed) : null,
        worst: Math.max(...ms.map((m) => m.hits ?? 99)),
        taken: Math.round(ms.reduce((t, m) => t + m.damageTakenPerKill, 0)),
        dmg: Math.round(ms.reduce((t, m) => t + m.damage, 0) * 10) / 10,
      };
    };
    const order = (
      a: { hits: number; taken: number; dmg: number; twoHitLv: number | null },
      b: { hits: number; taken: number; dmg: number; twoHitLv: number | null }
    ) => a.hits - b.hits || (b.twoHitLv ?? 0) - (a.twoHitLv ?? 0) || b.dmg - a.dmg || a.taken - b.taken;
    for (const q of ['Epic', 'Legendary'] as const) {
      const list = Object.values(PET_STATS)
        .filter((p) => p.quality === q && petTier(p.name) === q && PET_EGGS[p.name] && PET_EGGS[p.name].kind !== 'none')
        .map((p) => ({ species: p.name, label: p.name, quality: q, ...simulate(p.name), price: null, note: undefined }))
        .sort(order);
      bestSpecies[q] = list.map((x) => x.species);
      speciesOptions.push(...list);
    }
    const mythics = Object.values(PET_STATS)
      .filter((p) => p.quality === 'Mythic' && PET_EGGS[p.name]?.kind === 'fixed')
      .map((p) => simulate(p.name))
      .sort(order);
    const worstMythic = mythics[mythics.length - 1];
    if (worstMythic) speciesOptions.push({ species: null, label: 'Mythic egg (random species)', quality: 'Mythic', ...worstMythic, price: null, note: undefined });
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
      const owned = new Set(gear.map((g) => g.gear_item_id));
      for (const item of Array.from(gearCatalog.values())) {
        if (item.combat_level > cl || owned.has(item.id)) continue;
        const price = priceOf(item.name);
        if (!price || (upgrade && price >= upgrade.price)) continue;
        const clears = new Set([item.slot, ...(HAND_SLOT_CONFLICTS[item.slot] ?? [])]);
        const swapped = [...gear.filter((g) => !clears.has(g.slot)), { slot: item.slot, gear_item_id: item.id, tier: 1 }];
        const f = fighterWith(pet, swapped);
        const hs = hitsAt(f, zoneEnemies, slayer, null).map((m) => m.hits ?? 99);
        const m2 = Math.max(...hs) <= 2 ? max2HitLevel(f, zoneEnemies, slayer, scale.max, scale.allowed, scale.fixed) : null;
        const t = battleTier(hs, canPick, m2, goals);
        if (t > curTier) upgrade = { item: item.name, slot: item.slot, price, toTier: t };
      }
    }
  }

  // Recruiter check: cheapest tier-1 gear set that gets every mob here to 4 hits or fewer (Bronze).
  // Greedy on "hits over 4" removed per gold, then drop items that turn out unneeded.
  let minGear: MinGearPlan | undefined;
  if (ctx.planMinGear && zoneEnemies.length) {
    const pet = bestPet ? { species: bestPet.species, level: bestPet.level, evolution: bestPet.evolution } : null;
    const UNPRICED = 1e13;
    const items = Array.from(gearCatalog.values())
      .filter((i) => i.combat_level <= cl)
      .map((i) => ({ item: i, price: priceOf(i.name) || null }));
    const hitsOf = (set: GearSelection[]) => hitsAt(fighterWith(pet, set), zoneEnemies, slayer, null).map((m) => m.hits ?? 99);
    const over = (hs: number[]) => hs.reduce((t, h) => t + Math.max(0, h - 4), 0);
    const withItem = (set: GearSelection[], id: number, slot: string) => {
      const clears = new Set([slot, ...(HAND_SLOT_CONFLICTS[slot] ?? [])]);
      return [...set.filter((g) => !clears.has(g.slot)), { slot, gear_item_id: id, tier: 1 }];
    };
    let set: GearSelection[] = [];
    let cur = over(hitsOf(set));
    for (let step = 0; step < 10 && cur > 0; step++) {
      let best: { set: GearSelection[]; left: number; score: number; price: number } | null = null;
      for (const { item, price } of items) {
        if (set.some((g) => g.gear_item_id === item.id)) continue;
        const next = withItem(set, item.id, item.slot);
        const left = over(hitsOf(next));
        if (left >= cur) continue;
        const cost = price ?? UNPRICED;
        // Finishing beats progress; then gain per gold; ties → cheaper.
        const score = (left === 0 ? 1e20 / cost : 0) + (cur - left) / cost;
        if (!best || score > best.score || (score === best.score && cost < best.price)) best = { set: next, left, score, price: cost };
      }
      if (!best) break;
      set = best.set;
      cur = best.left;
    }
    if (cur === 0) {
      // Prune: most expensive first, drop anything not needed.
      const priceOfId = (id: number) => items.find((x) => x.item.id === id)?.price ?? UNPRICED;
      for (const g of [...set].sort((a, b) => priceOfId(b.gear_item_id) - priceOfId(a.gear_item_id))) {
        const without = set.filter((x) => x.slot !== g.slot);
        if (over(hitsOf(without)) === 0) set = without;
      }
    }
    const hs = hitsOf(set);
    const chosen = set.map((g) => {
      const it = gearCatalog.get(g.gear_item_id)!;
      return { slot: g.slot, item_id: it.id, name: it.name, quality: it.quality, combat_level: it.combat_level, price: priceOf(it.name) || null };
    });
    minGear = {
      reachable: over(hs) === 0,
      items: chosen,
      total: chosen.reduce((t, x) => t + (x.price ?? 0), 0),
      worstHits: hs.length ? Math.max(...hs) : null,
    };
  }

  const info = ctx.memberInfo.get(r.member_id);
  const participation = (PARTICIPATION.includes(r.participation as Participation) ? r.participation : 'auto') as Participation;
  const answer = ctx.answers.get(r.member_id) ?? null;
  const best = squad.squad[0];
  const row: RosterRow = {
    member_id: r.member_id,
    ign: r.ign,
    character_class: r.character_class,
    image_url: r.image_url,
    position: info?.position ?? null,
    combat_level: lvl(skills, 'combat'),
    hunting_mastery: lvl(skills, 'hunting-mastery'),
    pet_mastery: lvl(skills, 'pet-mastery'),
    dexterity: (r.stats as StatLevels | null)?.dexterity?.level ?? null,
    equipped_pet: ep ? { species: epSpecies, level: ep.level, evolution: ep.evolution ?? 0, tier: petTier(epSpecies) } : null,
    battle: {
      gearSet,
      loadout: loadout?.name ?? null,
      loadoutSource,
      provisionalPreset: provisionalId,
      loadoutPotions: loadout ? potionsOf(ctx, loadout) : [],
      preset: loadout ? presetOf(ctx, loadout) : null,
      potionTier: loadout ? potionTierOf(ctx, loadout) : 0,
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
      bestSpecies,
      speciesOptions,
      upgrade,
      ...(minGear ? { minGear } : {}),
    },
    hunting: {
      bow: huntingBow(info?.hunting_bow ?? null),
      squadSize: petSquadSize(pm),
      stableSize: HUNT_STABLE_SIZE,
      minPetLevel,
      eligibleCount: petRows.filter((p) => p.eligible).length,
      squadPower: squad.power,
      bestPet: best ? { species: best.species, level: best.level, citadelEncounters: best.citadelEncounters } : null,
      petCount: pets.length,
      byQuality,
      unknownPets: Array.from(new Set(resolved.filter((p) => !p.species).map((p) => p.name))),
      stableL100: [],
      eggOptions: [],
      bowOptions: [],
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
    rsvp: { answer, effective: effectiveRsvp(participation, answer) },
    participation,
    key_source: r.key_source ?? null,
    last_sync: r.last_sync ?? null,
    last_error: r.last_error ?? null,
    owner_user_id: owner,
    has_combat_profile: !!profile,
    discord_linked: !!info?.discord_id || (!!owner && ctx.discordOwners.has(owner)),
    gear_from_staff: !profileGear.length && staffGear.length > 0,
    gear: gear
      .map((g) => {
        const item = gearCatalog.get(g.gear_item_id);
        return item ? { slot: g.slot, gear_item_id: g.gear_item_id, tier: g.tier, name: item.name, quality: item.quality, image_url: item.image_url } : null;
      })
      .filter((g): g is RosterGear => !!g)
      .sort((a, b) => GEAR_SLOT_ORDER.indexOf(a.slot) - GEAR_SLOT_ORDER.indexOf(b.slot)),
  };

  // Next best moves evaluate the finished row.
  const priceCtx = { price: priceOf };
  row.hunting.stableL100 = stableAtL100(row);
  row.hunting.eggOptions = huntEggOptions(row.pet_mastery ?? 0, priceCtx);
  row.hunting.bowOptions = bowOptions(row, priceCtx);
  priceBattleOptions(row.battle.speciesOptions, priceCtx);
  row.moves = computeMoves(row, { goals, price: priceOf, presets: ctx.tieredPresets, marketAccess: hasMarketAccess(row.character_class) }).slice(0, 6);
  return row;
}

/* ─── roster ─── */

export async function buildRoster(
  guildId: string,
  supabase: SupabaseClient = createAdminClient(),
  zoneOverride?: number | null
): Promise<Roster | null> {
  const [{ data: guild }, { data: snaps }, { data: config }, { data: goalRow }, catalog] = await Promise.all([
    supabase.from('guilds').select('id, name, nickname, is_assault').eq('id', guildId).maybeSingle(),
    supabase.from('assault_roster').select('*').eq('guild_id', guildId),
    supabase.from('assault_configs').select('tracked_zone_id, zone_name').eq('guild_id', guildId).maybeSingle(),
    supabase.from('assault_roster_goals').select('goals').eq('guild_id', guildId).maybeSingle(),
    loadRowCatalog(supabase),
  ]);
  if (!guild || !guild.is_assault) return null;
  const goals: GoalSet = mergeGoals(goalRow?.goals);
  const waveUnix = await nextWaveUnix(guildId);
  const answers = waveUnix ? await rsvpsForWave(guildId, waveUnix, supabase) : new Map<string, RsvpStatus>();
  const rows = (snaps ?? []) as RosterSnapshot[];
  const trackedZoneId = (config?.tracked_zone_id as number | null) ?? null;
  const zoneId = zoneOverride && zoneOverride >= 1 && zoneOverride <= MAX_LOCATION_ID ? zoneOverride : trackedZoneId;

  const members = await loadRowMembers(supabase, rows.map((r) => r.member_id), rows.map((r) => r.hashed_id));
  const ctx: RosterRowContext = { ...catalog, ...members, ...zoneSlice(catalog, zoneId, goals), answers };
  const out = rows.map((r) => buildRosterRow(r, ctx));

  const pOrder = (p: Participation) => PARTICIPATION.indexOf(p);
  out.sort((a, b) => pOrder(a.participation) - pOrder(b.participation) || (b.combat_level ?? 0) - (a.combat_level ?? 0) || b.hunting.squadPower - a.hunting.squadPower);

  return {
    guild: { id: String(guild.id), name: guild.name, nickname: guild.nickname ?? null },
    zone: {
      id: zoneId,
      name: catalog.zones.find((z) => z.id === zoneId)?.name ?? (config?.zone_name as string) ?? null,
      enemyCount: ctx.zoneEnemies.length,
      isTracked: zoneId === trackedZoneId,
    },
    zones: catalog.zones,
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
