'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { AccountCharacter } from '@/contexts/AuthContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader2, RefreshCw, Swords, Trash2, UserPlus, Save, FlaskConical, Shield, Info, X, Pin } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useApiClient } from '@/lib/api-client';
import { RECOMMENDED_PRESET_ID } from '@/lib/potion-rules';
import {
  applyBuffs,
  buildCharacterStats,
  GEAR_SLOTS,
  equipGear,
  itemSlotOf,
  slotVisible,
  MAX_TIER,
  NO_BUFFS,
  slayerByEnemy,
  tieredGearStats,
  ZERO_STATS,
  type BuffState,
  type GearItem,
  type GearSelection,
  type StatBlock,
  type StatKey,
} from '@/lib/combat/character-stats';
import {
  accuracyForHitChance,
  agilityForEnemyHitChance,
  HP_TARGETS,
  enemyPower,
  estimateHP,
  findAPForHits,
  matchup,
  protectionForEnemyDamage,
} from '@/lib/combat/formulas';
import { PET_STATS, getPetMasteryBonus } from '@/lib/combat/pet-data';
import { registerCustomPets } from '@/lib/combat/custom-pets';
import { HUNTING_BOWS, bowBlocker } from '@/lib/combat/hunting-gear';
import { hasMarketAccess, CLASS_TALENTS } from '@/lib/combat/class-talents';
import { FOODS, foodByName, type Food } from '@/lib/combat/foods';
import { formatDuration, runAdvisor, type AdvisorOption, type AdvisorPotion } from '@/lib/combat/advisor';
import type {
  CombatProfile,
  Enemy,
  PetState,
  PotionLoadout,
  PotionPreset,
  PotionRow,
  ProfileSettings,
  SandboxState,
  SetupRow,
  TargetState,
  XpPotionRow,
} from './types';
import { clearSlot, kindOf, legalPotionIds, legalXpIds, potionIdsOf, potionKey, togglePotion, toggleXp, withPotions } from './potion-slots';

/* ─────────────────────────── helpers ─────────────────────────── */

const STAT_LABELS: Record<StatKey, string> = {
  attackPower: 'Attack Power',
  protection: 'Protection',
  agility: 'Agility',
  accuracy: 'Accuracy',
};
const STAT_KEYS: StatKey[] = ['attackPower', 'protection', 'agility', 'accuracy'];
const fmt = (n: number) => Math.round(n).toLocaleString();
const gold = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : `${Math.round(n)}`);

function NumField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  placeholder,
  className,
}: {
  label: string;
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  className?: string;
}) {
  return (
    <label className={`block space-y-1 ${className ?? ''}`}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <Input
        type="number"
        className="h-8"
        value={value ?? ''}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder}
        onChange={(e) => {
          const v = e.target.value === '' ? null : Number(e.target.value);
          onChange(v === null || Number.isNaN(v) ? null : v);
        }}
      />
    </label>
  );
}

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-xs rounded-md border px-2 py-1 transition-colors ${
        on ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted'
      }`}
    >
      {children}
    </button>
  );
}

function Select({
  value,
  onChange,
  children,
  className,
}: {
  value: string | number;
  onChange: (v: string) => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <select
      className={`h-8 w-full rounded-md border border-input bg-background px-2 text-sm ${className ?? ''}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {children}
    </select>
  );
}

const emptySandbox = (): SandboxState => ({
  pet: { mode: 'profile', species: null, level: 1, evolution: 0 },
  gear: [],
  buffs: { ...NO_BUFFS },
  target: { zoneId: null, enemyId: null, scaledLevel: null, customHp: null },
  counts: {},
});

/* ─────────────────────────── main ─────────────────────────── */

interface Bootstrap {
  profiles: CombatProfile[];
  setups: SetupRow[];
  gear: GearItem[];
  potions: PotionRow[];
  enemies: Enemy[];
  characters: AccountCharacter[];
  /** Stat calibration is assaulters only (a character in DE/DI) or super admin. */
  canCalibrate?: boolean;
  /** Potion loadouts (web + Discord), default first. */
  loadouts?: PotionLoadout[];
  /** Member of an assault guild (DE/DI): may take whole assault presets, XP slots included. */
  assaulter?: boolean;
  /** Assault potion presets + XP potions (assaulters only, else empty). */
  presets?: PotionPreset[];
  xpPotions?: XpPotionRow[];
  /** Hunting bow per member_id (members.hunting_bow, shared with /assault/roster). */
  huntingBows?: Record<string, string | null>;
}

export default function CombatClient() {
  const api = useApiClient();
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** API key / pets warning from the last open or sync (shared key used, pets not visible). */
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [memberId, setMemberId] = useState<string | null>(null);

  // Characters usable here: on your account (claimed or alt) and currently in a Dream guild.
  const usable = useMemo(() => (boot?.characters ?? []).filter((c) => c.in_dream_guild && c.hashed_id), [boot?.characters]);
  const selected = usable.find((c) => c.member_id === memberId) ?? null;
  const profile = selected ? boot?.profiles.find((p) => p.hashed_id === selected.hashed_id) ?? null : null;

  const replaceProfile = useCallback(
    (p: CombatProfile) =>
      setBoot((b) => (b ? { ...b, profiles: b.profiles.some((x) => x.id === p.id) ? b.profiles.map((x) => (x.id === p.id ? p : x)) : [...b.profiles, p] } : b)),
    []
  );

  const open = useCallback(
    async (id: string) => {
      setBusy('open');
      setError(null);
      const res = await api.post('/api/combat/profile', { member_id: id });
      const data = await res.json();
      setBusy(null);
      if (!res.ok) return setError(data.error ?? 'Could not load character');
      setNotice(data.notice ?? null);
      replaceProfile(data.profile);
    },
    [api, replaceProfile]
  );

  useEffect(() => {
    (async () => {
      const res = await api.get('/api/combat/bootstrap');
      const data = await res.json();
      if (!res.ok) return setError(data.error ?? 'Failed to load');
      registerCustomPets(data.customPets ?? []);
      setBoot(data);
      const chars: AccountCharacter[] = (data.characters ?? []).filter((c: AccountCharacter) => c.in_dream_guild && c.hashed_id);
      // ?setup=<id> (from /me/assault): open that setup's character.
      const wanted = new URLSearchParams(window.location.search).get('setup');
      const wantedProfile = wanted
        ? data.profiles.find((p: CombatProfile) => p.id === data.setups.find((s: SetupRow) => s.id === wanted)?.profile_id)
        : null;
      const fromSetup = wantedProfile ? chars.find((c) => c.hashed_id === wantedProfile.hashed_id) : undefined;
      const withProfile = chars.find((c) => data.profiles.some((p: CombatProfile) => p.hashed_id === c.hashed_id));
      const first = fromSetup ?? withProfile ?? chars.find((c) => c.claimed) ?? chars[0];
      if (first) setMemberId(first.member_id);
    })();
  }, [api]);

  // Profiles synced before skills were stored: refresh once so combat level / pet mastery are real.
  const autoSynced = useRef(new Set<string>());
  useEffect(() => {
    if (profile && !profile.skills && !busy && !autoSynced.current.has(profile.id)) {
      autoSynced.current.add(profile.id);
      sync();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, profile?.skills, busy]);

  // First visit to a character: create its profile from the API.
  useEffect(() => {
    if (selected && !profile && busy !== 'open') open(selected.member_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.member_id, profile]);

  async function sync() {
    if (!profile) return;
    setBusy('sync');
    setError(null);
    const res = await api.post('/api/combat/profile/sync', { id: profile.id });
    const data = await res.json();
    setBusy(null);
    if (!res.ok) return setError(data.error ?? 'Sync failed');
    setNotice(data.notice ?? null);
    replaceProfile(data.profile);
  }

  async function resetProfile() {
    if (!profile || !confirm(`Clear saved gear and settings for ${profile.ign}?`)) return;
    await api.delete(`/api/combat/profile?id=${profile.id}`);
    setBoot((b) => (b ? { ...b, profiles: b.profiles.filter((p) => p.id !== profile.id) } : b));
  }

  if (!boot) {
    return (
      <div className="container mx-auto py-16 flex justify-center">
        {error ? <p className="text-red-500 text-sm">{error}</p> : <Loader2 className="h-6 w-6 animate-spin" />}
      </div>
    );
  }

  if (usable.length === 0) {
    const left = boot.characters.length > 0;
    return (
      <div className="container mx-auto max-w-xl py-16">
        <Card>
          <CardContent className="pt-6 space-y-3 text-center">
            <Swords className="h-8 w-8 text-orange-500 mx-auto" />
            <p className="font-semibold">{left ? 'None of your characters are in a Dream guild right now.' : 'Claim your character to use the combat tool.'}</p>
            <p className="text-sm text-muted-foreground">
              Characters (and their alts) are linked on My characters, then approved by a guild leader, deputy or officer.
            </p>
            <Link href="/account"><Button>My characters</Button></Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-6 space-y-4 max-w-7xl">
      <div className="flex flex-wrap items-center gap-3">
        <Swords className="h-6 w-6 text-orange-500" />
        <h1 className="text-2xl font-bold">Combat Tool</h1>
        <div className="flex flex-wrap items-center gap-2 ml-auto">
          {profile && (
            <>
              <Button size="sm" variant="outline" onClick={sync} disabled={busy === 'sync'}>
                {busy === 'sync' ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
                Sync
              </Button>
              <Button size="sm" variant="ghost" onClick={resetProfile} title="Clear saved gear & settings">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
          <Link href="/account"><Button size="sm" variant="outline"><UserPlus className="h-3.5 w-3.5 mr-1" />My characters</Button></Link>
        </div>
      </div>

      {/* character switcher: all your characters + alts across Dream guilds */}
      <div className="flex flex-wrap gap-1.5">
        {usable.map((c) => (
          <button
            key={c.member_id}
            onClick={() => setMemberId(c.member_id)}
            className={`flex items-center gap-1.5 text-sm border rounded-md px-2 py-1 transition-colors ${
              c.member_id === memberId ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted'
            }`}
          >
            {c.avatar_url && <img src={c.avatar_url} alt="" className="h-5 w-5 rounded" />}
            {c.ign}
            <span className="text-[10px] opacity-70">{c.guild_nickname}</span>
            {!c.claimed && <span className="text-[10px] opacity-60">alt</span>}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}
      {notice && (
        <p className="text-sm text-amber-600 dark:text-amber-400">
          {notice.split(/(https:\/\/\S+?(?=[\s.,]*(?:\s|$))|\/setup)/).map((part, i) =>
            part === '/setup' || part.startsWith('https://') ? (
              <a key={i} href={part} target={part === '/setup' ? undefined : '_blank'} rel="noreferrer" className="underline">
                {part}
              </a>
            ) : (
              part
            )
          )}
        </p>
      )}

      {profile ? (
        <Workbench
          key={profile.id}
          profile={profile}
          boot={boot}
          onProfileSaved={replaceProfile}
          onSetupsChanged={(setups) => setBoot((b) => (b ? { ...b, setups } : b))}
        />
      ) : (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin" /></div>
      )}
    </div>
  );
}

/* ─────────────────────────── workbench ─────────────────────────── */

/** Enemy scaling: members CL 80+ can scale mobs up to their combat level; CL 100+ up to 150. */
function scalingRange(combatLevel: number): { allowed: boolean; max: number } {
  if (combatLevel < 80) return { allowed: false, max: 0 };
  return { allowed: true, max: combatLevel >= 100 ? 150 : combatLevel };
}

function Workbench({
  profile,
  boot,
  onProfileSaved,
  onSetupsChanged,
}: {
  profile: CombatProfile;
  boot: Bootstrap;
  onProfileSaved: (p: CombatProfile) => void;
  onSetupsChanged: (s: SetupRow[]) => void;
}) {
  const api = useApiClient();
  const gearCatalog = useMemo(() => new Map(boot.gear.map((g) => [g.id, g])), [boot.gear]);

  /* potions: start from your real assault loadout (default one from /assault/potions or Discord) */
  const potionById = useMemo(() => new Map(boot.potions.map((p) => [p.id, p])), [boot.potions]);
  const xpById = useMemo(() => new Map((boot.xpPotions ?? []).map((p) => [p.id, p])), [boot.xpPotions]);
  const [loadouts, setLoadouts] = useState<PotionLoadout[]>(boot.loadouts ?? []);
  const myLoadout = loadouts.find((l) => l.is_default) ?? loadouts[0] ?? null;
  const loadoutIds = useMemo(() => legalPotionIds(myLoadout?.combat_potion_ids ?? [], potionById), [myLoadout, potionById]);
  const loadoutXpIds = useMemo(() => legalXpIds(myLoadout?.xp_potion_ids ?? [], xpById), [myLoadout, xpById]);
  const loadoutBuffs = () => ({ ...withPotions({ ...NO_BUFFS }, loadoutIds, potionById), xpPotionIds: loadoutXpIds });

  /* profile-backed (saved to the character automatically) */
  const [settings, setSettings] = useState<ProfileSettings>(profile.settings ?? {});
  const [profileGear, setProfileGear] = useState<GearSelection[]>(profile.gear ?? []);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');

  /* sandbox (only kept if you save a setup) */
  const [sb, setSb] = useState<SandboxState>(() => {
    const s = emptySandbox();
    s.buffs = loadoutBuffs();
    const zone = boot.enemies.find((e) => e.zone_id === profile.location?.id) ?? boot.enemies[0];
    s.target.zoneId = zone?.zone_id ?? null;
    s.target.enemyId = zone?.id ?? null;
    return s;
  });
  const [gearSandbox, setGearSandbox] = useState(false);
  const [activeSetupId, setActiveSetupId] = useState<string | null>(null);
  const [bpTargets, setBpTargets] = useState<BpTargets>(RECOMMENDED_BP);

  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setSaveState('saving');
    const t = setTimeout(async () => {
      const res = await api.patch('/api/combat/profile', { id: profile.id, settings, gear: profileGear });
      if (res.ok) {
        onProfileSaved((await res.json()).profile);
        setSaveState('saved');
      } else setSaveState('idle');
    }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, profileGear]);

  const setSetting = <K extends keyof ProfileSettings>(k: K, v: ProfileSettings[K]) => setSettings((s) => ({ ...s, [k]: v }));
  const patchSb = (p: Partial<SandboxState>) => setSb((s) => ({ ...s, ...p }));
  const patchTarget = (p: Partial<TargetState>) => setSb((s) => ({ ...s, target: { ...s.target, ...p } }));

  /* ── synced levels ── */
  const petMastery = profile.skills?.['pet-mastery']?.level ?? settings.petMastery ?? 0;
  const needsResync = !profile.skills;
  const combatXp = profile.skills?.combat?.experience ?? 0;
  const ascension = ascensionLevel(combatXp, profile.skills?.combat?.level ?? 0);

  /* ── pet ── */
  const profilePet = profile.equipped_pet;
  const activePet = useMemo(() => {
    if (sb.pet.mode === 'profile') {
      return profilePet ? { species: profilePet.species, level: profilePet.level, evolution: profilePet.evolution ?? 0 } : null;
    }
    return sb.pet.species ? { species: sb.pet.species, level: sb.pet.level, evolution: sb.pet.evolution } : null;
  }, [sb.pet, profilePet]);

  /* ── stats ── */
  const gear = gearSandbox ? sb.gear : profileGear;
  const canCalibrate = !!boot.canCalibrate;
  const manual = (canCalibrate && settings.manual) || ZERO_STATS;
  const charInput = (m: StatBlock) => ({
    stats: profile.stats,
    skills: profile.skills,
    characterClass: sb.classOverride ?? profile.character_class,
    pet: activePet
      ? { species: activePet.species, level: activePet.level, mastery: petMastery, patted: !!settings.petPatted, evolution: activePet.evolution }
      : null,
    gear,
    gearCatalog,
    manual: m,
  });
  const char = buildCharacterStats(charInput(manual));
  const buffed = applyBuffs(char, sb.buffs);
  const fighter = { ...buffed, critChance: char.critChance.total, critDamage: char.critDamage.total, damageFlat: char.damageFlat.total };

  /* ── target ── */
  const zones = useMemo(() => {
    const m = new Map<number, string>();
    boot.enemies.forEach((e) => m.set(e.zone_id, e.zone_name));
    return Array.from(m.entries());
  }, [boot.enemies]);
  const zoneEnemies = boot.enemies.filter((e) => e.zone_id === sb.target.zoneId);
  const enemy = zoneEnemies.find((e) => e.id === sb.target.enemyId) ?? zoneEnemies[0] ?? null;
  const slayer = useMemo(() => slayerByEnemy(profile.effects), [profile.effects]);
  const scale = scalingRange(char.combatLevel);
  const scaledTo = scale.allowed && sb.target.scaledLevel ? Math.min(sb.target.scaledLevel, scale.max) : null;

  const resolveEnemy = (e: Enemy) => {
    const level = scaledTo && scaledTo > e.level ? scaledTo : e.level;
    // API HP for the real level; scaled mobs use the calibrated HP curve (citadel mobs have their own).
    const hp = level === e.level ? e.health : estimateHP(HP_TARGETS[e.name] ? e.name : 'Standard Mob', level);
    const override = e.id === sb.target.enemyId && sb.target.customHp ? sb.target.customHp : null;
    return { level, hp: override ?? hp, slayerPct: sb.slayer?.[e.id] ?? slayer[e.id] ?? 0 };
  };
  const target = enemy ? resolveEnemy(enemy) : null;
  // Slayer sandbox: assaulters only (same rule as stat calibration). Matching your real rank clears the override.
  const setSlayer = (id: number, pct: number | null) =>
    setSb((s) => {
      const next = { ...(s.slayer ?? {}) };
      if (pct == null || pct === (slayer[id] ?? 0)) delete next[id];
      else next[id] = pct;
      return { ...s, slayer: next };
    });
  const slayerSandboxed = Object.keys(sb.slayer ?? {}).length > 0;
  const result = target ? matchup(fighter, target, target.slayerPct) : null;

  /* ── setups ── */
  async function saveSetup(existing?: SetupRow) {
    const name = existing?.name ?? prompt('Name this setup (e.g. "Frenzy + Orthrus @ Celestial")', `${enemy?.zone_name ?? 'Setup'} – ${activePet?.species ?? 'no pet'}`);
    if (!name) return;
    const res = await api.post('/api/combat/setups', {
      id: existing?.id,
      profile_id: profile.id,
      name,
      data: { ...sb, gearMode: gearSandbox ? 'sandbox' : 'mine', gear: gearSandbox ? sb.gear : [] },
    });
    const data = await res.json();
    if (res.ok) {
      onSetupsChanged([data.setup, ...boot.setups.filter((s) => s.id !== data.setup.id)]);
      setActiveSetupId(data.setup.id);
    }
  }
  function loadSetup(s: SetupRow) {
    const buffs = { ...NO_BUFFS, ...s.data.buffs };
    const ids = potionIdsOf(buffs, boot.potions);
    setSb({
      ...emptySandbox(),
      ...s.data,
      // Older setups only stored potion %: map them onto real potions when they match one.
      buffs: ids ? withPotions(buffs, ids, potionById) : buffs,
      target: { ...emptySandbox().target, ...s.data.target },
    });
    // Older setups have no gearMode: treat as sandbox only if their gear differs from your saved gear.
    const key = (g: GearSelection[]) => JSON.stringify([...g].sort((a, b) => a.slot.localeCompare(b.slot)).map((x) => [x.slot, x.gear_item_id, x.tier]));
    const usesSandboxGear = s.data.gearMode ? s.data.gearMode === 'sandbox' : key(s.data.gear ?? []) !== key(profileGear);
    setGearSandbox(usesSandboxGear);
    setActiveSetupId(s.id);
  }
  // ?setup=<id> (from /me/assault): load it once when this character's workbench opens.
  const urlSetupDone = useRef(false);
  useEffect(() => {
    if (urlSetupDone.current) return;
    urlSetupDone.current = true;
    const wanted = new URLSearchParams(window.location.search).get('setup');
    const s = wanted ? boot.setups.find((x) => x.id === wanted && (x.profile_id === profile.id || !x.profile_id)) : null;
    if (s) loadSetup(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function togglePin(s: SetupRow) {
    const res = await api.patch('/api/combat/setups', { id: s.id, pinned: !s.pinned });
    if (!res.ok) return alert((await res.json().catch(() => ({}))).error ?? 'Could not pin');
    onSetupsChanged(boot.setups.map((x) => ({ ...x, pinned: x.id === s.id ? !s.pinned : false })));
  }
  function resetToCharacter() {
    // Siege buffs are situational, so they stay; potions go back to your loadout.
    setSb((cur) => ({
      ...emptySandbox(),
      buffs: { ...withPotions(cur.buffs, loadoutIds, potionById), xpPotionIds: loadoutXpIds },
      target: cur.target,
      counts: cur.counts,
    }));
    setGearSandbox(false);
    setActiveSetupId(null);
  }
  async function deleteSetup(s: SetupRow) {
    if (!confirm(`Delete setup "${s.name}"?`)) return;
    await api.delete(`/api/combat/setups?id=${s.id}`);
    onSetupsChanged(boot.setups.filter((x) => x.id !== s.id));
    if (activeSetupId === s.id) setActiveSetupId(null);
  }
  const mySetups = boot.setups.filter((s) => s.profile_id === profile.id || !s.profile_id);
  const activeSetup = mySetups.find((s) => s.id === activeSetupId) ?? null;
  const pickedIds = potionIdsOf(sb.buffs, boot.potions);
  const pickedXpIds = legalXpIds(sb.buffs.xpPotionIds ?? [], xpById);
  const potionsDiffer =
    pickedIds == null || potionKey(pickedIds) !== potionKey(loadoutIds) || (!!boot.assaulter && potionKey(pickedXpIds) !== potionKey(loadoutXpIds));
  const sandboxActive = gearSandbox || sb.pet.mode === 'sandbox' || !!sb.classOverride || potionsDiffer || slayerSandboxed || !!activeSetup;
  const setPotionIds = (ids: number[]) => setSb((s) => ({ ...s, buffs: withPotions(s.buffs, ids, potionById) }));
  const setXpIds = (ids: number[]) => setSb((s) => ({ ...s, buffs: { ...s.buffs, xpPotionIds: legalXpIds(ids, xpById) } }));
  /** A whole preset / loadout: combat slots + XP slots together. */
  const applyPotions = (combatIds: number[], xpIds: number[]) =>
    setSb((s) => ({ ...s, buffs: { ...withPotions(s.buffs, combatIds, potionById), xpPotionIds: legalXpIds(xpIds, xpById) } }));
  const [savingLoadout, setSavingLoadout] = useState(false);
  /** Save what's in the slots as your assault loadout (default), shared with /assault/potions and Discord. */
  async function saveAsLoadout(suggested: string) {
    const name = window.prompt('Save as your assault loadout (also on /assault/potions and Discord). Name:', suggested)?.trim();
    if (!name) return;
    setSavingLoadout(true);
    const res = await api.post('/api/assault/potions/loadouts', {
      name,
      is_default: true,
      combat_potion_ids: pickedIds ?? [],
      xp_potion_ids: pickedXpIds,
    });
    const data = await res.json().catch(() => ({}));
    setSavingLoadout(false);
    if (!res.ok || !data.loadout) return alert(data.error ?? 'Could not save loadout');
    const l = data.loadout;
    setLoadouts((cur) => [
      { id: l.id, name: l.name, is_default: true, source: 'web', combat_potion_ids: l.combat_potion_ids ?? [], xp_potion_ids: l.xp_potion_ids ?? [] },
      ...cur.filter((x) => x.id !== l.id).map((x) => ({ ...x, is_default: false })),
    ]);
  }

  return (
    <div className="space-y-4">
      {/* ── character strip ── */}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {profile.image_url && <img src={profile.image_url} alt="" className="h-10 w-10 rounded" />}
        <div>
          <div className="font-semibold">
            {profile.ign}{' '}
            <span className="text-muted-foreground font-normal">
              · {prettyClass(profile.character_class)} · CL {char.combatLevel}
              {ascension > 0 && <AscensionBadge level={ascension} xp={combatXp} />}
              {needsResync && <span className="text-amber-400" title="Estimated from stat levels until synced"> (est.)</span>}
              {' '}· Pet mastery {petMastery}
            </span>
          </div>
          <div className="text-xs text-muted-foreground">
            {profile.location?.name ?? 'Unknown location'} · synced {profile.last_sync ? new Date(profile.last_sync).toLocaleString() : 'never'}
            {needsResync && <span className="text-amber-400"> · press Sync to load combat level &amp; pet mastery</span>}
          </div>
        </div>
      </div>

      {/* ── saved / setups bar ── */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border px-3 py-2 text-sm">
        <Popover>
          <PopoverTrigger asChild>
            <button className="flex items-center gap-1.5 text-xs hover:text-foreground text-muted-foreground" title="What gets saved where">
              <span className={saveState === 'saving' ? 'text-amber-400' : 'text-green-500'}>{saveState === 'saving' ? '●' : '✓'}</span>
              <span>
                {saveState === 'saving' ? 'Saving…' : 'Saved to'} <b className="text-foreground">{profile.ign}</b>
              </span>
              <Info className="h-3.5 w-3.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-80 text-xs space-y-2">
            <p>
              <b>Saved to {profile.ign} automatically:</b> My gear + tiers, pet patted, max HP, food{canCalibrate ? ' and stat calibration' : ''}. Stats, pet, combat
              level, pet mastery and slayer ranks come from Sync.
            </p>
            <p>
              <b>Setups</b> are what-if snapshots: pet choice (equipped or sandbox), gear incl. sandbox, buffs, zone, target, scaling and
              enemy counts. Loading one never changes your saved loadout.
            </p>
          </PopoverContent>
        </Popover>
        <span className="h-4 w-px bg-border hidden sm:block" />
        <span className="text-xs text-muted-foreground">Setups</span>
        {mySetups.map((s) => (
          <span key={s.id} className={`inline-flex items-center border rounded text-xs ${activeSetupId === s.id ? 'border-primary bg-primary/10' : ''}`}>
            <button className="px-2 py-0.5 hover:bg-muted" onClick={() => loadSetup(s)} title="Load">{s.name}</button>
            <button className={`px-1 py-0.5 hover:bg-muted ${s.pinned ? 'text-crystal' : 'text-muted-foreground'}`} title={s.pinned ? 'Pinned to My assault · unpin' : 'Pin to My assault'} onClick={() => togglePin(s)}><Pin className="h-3 w-3" /></button>
            <button className="px-1 py-0.5 hover:bg-muted text-muted-foreground" title="Overwrite with current" onClick={() => saveSetup(s)}><Save className="h-3 w-3" /></button>
            <button className="px-1 py-0.5 hover:bg-muted text-muted-foreground" title="Delete" onClick={() => deleteSetup(s)}><Trash2 className="h-3 w-3" /></button>
          </span>
        ))}
        <button className="text-xs inline-flex items-center gap-1 border border-dashed rounded px-2 py-0.5 hover:bg-muted" onClick={() => saveSetup()}>
          <Save className="h-3 w-3" /> Save current
        </button>
        {sandboxActive && (
          <button className="text-xs text-amber-400 hover:underline ml-auto" onClick={resetToCharacter}>
            Sandbox active · back to my loadout
          </button>
        )}
      </div>

      <ZoneSweep
        zones={zones}
        zoneId={sb.target.zoneId}
        onZone={(zid) => patchTarget({ zoneId: zid, enemyId: boot.enemies.find((e) => e.zone_id === zid)?.id ?? null, customHp: null })}
        enemies={zoneEnemies}
        resolve={resolveEnemy}
        fighter={fighter}
        selectedId={enemy?.id ?? null}
        onSelect={(id) => patchTarget({ enemyId: id, customHp: null })}
        scale={scale}
        scaledLevel={sb.target.scaledLevel}
        onScale={(v) => patchTarget({ scaledLevel: v })}
        combatLevel={char.combatLevel}
        realSlayer={slayer}
        onSlayer={canCalibrate ? setSlayer : undefined}
        detail={
          enemy && target && result ? (
            <BreakpointsPanel
              fighter={fighter}
              base={char}
              buffs={sb.buffs}
              target={target}
              hits={result.hits}
              targets={bpTargets}
              setTargets={setBpTargets}
              meta={
                <>
                  Enemy power {enemyPower(target.level)} · ~{fmt(result.damageTakenPerKill)} dmg taken/kill · HP
                  <input
                    type="number"
                    className="ml-1 w-16 rounded border bg-transparent px-1 text-xs"
                    value={sb.target.customHp ?? ''}
                    placeholder={String(enemy.health)}
                    title="HP override"
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => patchTarget({ customHp: e.target.value === '' ? null : Number(e.target.value) || null })}
                  />
                </>
              }
            />
          ) : null
        }
      />

      <div className="grid gap-4 lg:grid-cols-2 items-stretch">
        <GearCard
          className="h-full"
          catalog={boot.gear}
          gear={gear}
          setGear={(g) => (gearSandbox ? patchSb({ gear: g }) : setProfileGear(g))}
          sandbox={gearSandbox}
          setSandbox={(on) => {
            if (on) patchSb({ gear: profileGear });
            setGearSandbox(on);
          }}
          combatLevel={char.combatLevel}
          gearStats={char.breakdown.gear}
          critDamage={char.critDamageFromGear}
          critChance={char.critChance.gear}
          footer={
            <HuntingBowPicker
              key={profile.id}
              profileId={profile.id}
              initial={profile.member_id ? boot.huntingBows?.[profile.member_id] ?? null : null}
              combatLevel={char.combatLevel}
              dexterity={profile.stats?.dexterity?.level ?? 0}
            />
          }
        />
        <div className="flex flex-col gap-4">
          <BuffsCard
            buffs={sb.buffs}
            setBuffs={(b) => patchSb({ buffs: b })}
            pickedIds={pickedIds}
            setPotionIds={setPotionIds}
            potions={boot.potions}
            potionById={potionById}
            loadouts={loadouts}
            myLoadout={myLoadout}
            differs={potionsDiffer}
            assaulter={!!boot.assaulter}
            presets={boot.presets ?? []}
            xpPotions={boot.xpPotions ?? []}
            xpById={xpById}
            xpIds={pickedXpIds}
            setXpIds={setXpIds}
            applyPotions={applyPotions}
            onSaveLoadout={saveAsLoadout}
            savingLoadout={savingLoadout}
          />
          <PetCard
            pet={sb.pet}
            setPet={(p) => patchSb({ pet: { ...sb.pet, ...p } })}
            profile={profile}
            mastery={petMastery}
            patted={!!settings.petPatted}
            setPatted={(v) => setSetting('petPatted', v)}
            char={char}
          />
          <SheetCard
            char={char}
            buffed={buffed}
            manual={manual}
            canCalibrate={canCalibrate}
            calibrate={(k, inGame) => {
              const withoutManual = buildCharacterStats(charInput(ZERO_STATS));
              setSetting('manual', { ...manual, [k]: inGame == null ? 0 : inGame - withoutManual[k] });
            }}
            settings={settings}
            setSetting={setSetting}
            realClass={profile.character_class}
            classOverride={sb.classOverride ?? null}
            onClassOverride={(c) => patchSb({ classOverride: c })}
            className="flex-1"
          />
        </div>
      </div>

      <PotionAdvisor
        enemies={zoneEnemies}
        resolve={resolveEnemy}
        counts={sb.counts}
        setCounts={(c) => patchSb({ counts: c })}
        base={char}
        buffs={sb.buffs}
        critChance={fighter.critChance}
        critDamage={fighter.critDamage}
        damageFlat={fighter.damageFlat}
        potions={boot.potions}
        onUse={setPotionIds}
        maxHp={settings.maxHp ?? null}
        food={foodByName(settings.food)}
        marketAccess={hasMarketAccess(profile.character_class)}
        characterClass={profile.character_class}
      />
    </div>
  );
}

/** XP needed for level 100 (same curve as dungeoneering). */
const LEVEL_100_XP = 16_310_118;
/** Level 100 = ascension 1, then +1 per 1M combat XP. */
function ascensionLevel(xp: number, level: number) {
  if (level < 100) return 0;
  return Math.floor(Math.max(0, xp - LEVEL_100_XP) / 1_000_000) + 1;
}

/** In-game style ascension mark: three orange stars shrinking down a diagonal, then the level. */
function AscensionBadge({ level, xp }: { level: number; xp: number }) {
  const intoNext = Math.max(0, xp - LEVEL_100_XP) % 1_000_000;
  const star = (cx: number, cy: number, r: number) => {
    const pts = Array.from({ length: 10 }, (_, i) => {
      const a = (Math.PI / 5) * i - Math.PI / 2;
      const rr = i % 2 === 0 ? r : r * 0.45;
      return `${(cx + rr * Math.cos(a)).toFixed(2)},${(cy + rr * Math.sin(a)).toFixed(2)}`;
    });
    return <polygon points={pts.join(' ')} />;
  };
  return (
    <span
      className="inline-flex items-center gap-0.5 ml-1.5 align-middle text-orange-400 font-semibold"
      title={`Ascension ${level} · ${(intoNext / 1_000_000 * 100).toFixed(0)}% to ${level + 1}`}
    >
      <svg viewBox="0 0 16 16" className="h-4 w-4 fill-orange-400" aria-hidden>
        {star(5.5, 5.5, 5)}
        {star(11.2, 10, 3)}
        {star(14, 14, 1.9)}
      </svg>
      <span className="text-sm">{level}</span>
    </span>
  );
}

const prettyClass = (c: string | null) => (c ? c.charAt(0) + c.slice(1).toLowerCase() : '—');

/* ─────────────────────────── cards ─────────────────────────── */

function Breakdown({ parts }: { parts: [string, number][] }) {
  const shown = parts.filter(([, v]) => v);
  return (
    <div className="text-[11px] text-muted-foreground">
      {shown.length ? shown.map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${v}`).join(' · ') : '—'}
    </div>
  );
}

/** Only classes with battle talents change combat; everything else behaves like "no talents". */
const COMBAT_CLASSES = Object.keys(CLASS_TALENTS);
const NO_TALENT_CLASS = 'BLACKSMITH';

function ClassPicker({ real, override, onChange }: { real: string | null; override: string | null; onChange: (c: string | null) => void }) {
  const realUpper = (real ?? '').toUpperCase();
  const realIsCombat = COMBAT_CLASSES.includes(realUpper);
  const value = override ?? '';
  const options: { value: string; label: string }[] = [
    ...COMBAT_CLASSES.filter((c) => c !== realUpper).map((c) => ({ value: c, label: prettyClass(c) })),
    ...(realIsCombat ? [{ value: NO_TALENT_CLASS, label: 'No combat class' }] : []),
  ];
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value || null)}
      title="Try another class's battle talents (sandbox, not saved to your character)"
      className={`ml-auto h-6 rounded border bg-transparent px-1.5 text-xs cursor-pointer ${
        override ? 'border-amber-500/60 text-amber-400' : 'border-transparent text-muted-foreground hover:border-border'
      }`}
    >
      <option value="">{prettyClass(real)}{override ? ' (real)' : ''}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label} · sandbox</option>
      ))}
    </select>
  );
}

function SheetCard({
  char,
  buffed,
  manual,
  canCalibrate,
  calibrate,
  settings,
  setSetting,
  className,
  realClass,
  classOverride,
  onClassOverride,
}: {
  className?: string;
  realClass: string | null;
  classOverride: string | null;
  onClassOverride: (c: string | null) => void;
  char: ReturnType<typeof buildCharacterStats>;
  buffed: StatBlock;
  manual: StatBlock;
  canCalibrate: boolean;
  calibrate: (k: StatKey, inGame: number | null) => void;
  settings: ProfileSettings;
  setSetting: <K extends keyof ProfileSettings>(k: K, v: ProfileSettings[K]) => void;
}) {
  const [open, setOpen] = useState(false);
  const b = char.breakdown;
  const t = char.talents;
  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <CardTitle className="text-base">Your Sheet</CardTitle>
          <ClassPicker real={realClass} override={classOverride} onChange={onClassOverride} />
        </div>
        <CardDescription>Stat levels ×2.4 + pet + gear + class talents. {canCalibrate ? 'Calibrate if a value differs from your in-game sheet. ' : ''}Amber = with buffs.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {STAT_KEYS.map((k) => (
            <div key={k} className="rounded-md border p-2">
              <div className="text-xs text-muted-foreground">{STAT_LABELS[k]}</div>
              <div className="text-xl font-bold">
                {fmt(char[k])}
                {buffed[k] !== char[k] && <span className="text-sm text-amber-400 ml-1">→ {fmt(buffed[k])}</span>}
              </div>
              <Breakdown parts={[['Lv', b.levels[k]], ['Pet', b.pet[k]], ['Gear', b.gear[k]], ['Class', b.classBonus[k]], ...(canCalibrate ? [['Adj', manual[k]] as [string, number]] : [])]} />
              {open && (
                <Input
                  type="number"
                  className="h-6 text-xs mt-1"
                  placeholder="in-game value → calibrate"
                  onBlur={(e) => {
                    if (e.target.value !== '') calibrate(k, Number(e.target.value));
                    e.target.value = '';
                  }}
                />
              )}
            </div>
          ))}
          <div className="rounded-md border p-2">
            <div className="text-xs text-muted-foreground">Crit chance</div>
            <div className="text-xl font-bold">{char.critChance.total}%</div>
            <Breakdown parts={[['Base', char.critChance.base], ['Pet', char.critChance.pet], ['Gear', char.critChance.gear], ['Class', char.critChance.classBonus]]} />
          </div>
          <div className="rounded-md border p-2">
            <div className="text-xs text-muted-foreground">Crit damage</div>
            <div className="text-xl font-bold">{char.critDamage.total}</div>
            <Breakdown parts={[['Pet', char.critDamage.pet], ['Gear', char.critDamage.gear], ['Class', char.critDamage.classBonus]]} />
          </div>
        </div>
        {(t.active.length > 0 || t.locked.length > 0) && (
          <div className="flex flex-wrap gap-1 text-[11px]">
            {t.active.map((x) => <Badge key={x.name} variant="secondary">{x.name}</Badge>)}
            {t.locked.map((x) => <Badge key={x.name} variant="outline" className="opacity-60">🔒 {x.name} (CL {x.unlockLevel})</Badge>)}
            {char.damageFlat.total > 0 && <span className="text-muted-foreground self-center">+{char.damageFlat.total} flat damage</span>}
          </div>
        )}
        {canCalibrate ? (
        <div className="flex gap-3">
          <button className="text-xs underline text-muted-foreground" onClick={() => setOpen((v) => !v)}>
            {open ? 'Done calibrating' : 'Calibrate stats'}
          </button>
          {STAT_KEYS.some((k) => manual[k]) && (
            <button className="text-xs underline text-muted-foreground" onClick={() => setSetting('manual', { ...ZERO_STATS })}>Reset calibration</button>
          )}
        </div>
        ) : (
          <p className="text-xs text-muted-foreground">Stat calibration is for assault guild members (Dream Engineers / Dream Invaders).</p>
        )}
        <div className="border-t pt-3">
        <div className="grid grid-cols-2 gap-2">
          <NumField label="Max HP (for food estimate)" value={settings.maxHp} onChange={(v) => setSetting('maxHp', v ?? undefined)} />
          <label className="space-y-1 block">
            <span className="text-xs text-muted-foreground">Food</span>
            <Select value={foodByName(settings.food).name} onChange={(v) => setSetting('food', v)}>
              {FOODS.map((f) => (
                <option key={f.name} value={f.name}>{f.name.replace('Cooked ', '')} · +{f.hp} HP · ~{f.price}g</option>
              ))}
            </Select>
          </label>
        </div>
        </div>
      </CardContent>
    </Card>
  );
}

/** Optional hunting bow (separate from the combat bow). Same value as on /assault/roster. */
function HuntingBowPicker({
  profileId, initial, combatLevel, dexterity,
}: { profileId: string; initial: string | null; combatLevel: number; dexterity: number }) {
  const api = useApiClient();
  const [bow, setBow] = useState<string | null>(initial);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const save = async (name: string | null) => {
    setBow(name);
    setState('saving');
    const res = await api.patch('/api/combat/profile', { id: profileId, hunting_bow: name });
    setState(res.ok ? 'saved' : 'error');
  };
  const current = HUNTING_BOWS.find((b) => b.name === bow);
  return (
    <div className="border-t pt-3 mt-2 space-y-1">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-medium">Hunting bow <span className="font-normal text-muted-foreground">optional · not part of your combat stats</span></span>
        <span className="text-muted-foreground">
          {state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : state === 'error' ? <span className="text-red-500">Not saved</span> : current ? `+${current.huntEff}% hunt efficiency` : ''}
        </span>
      </div>
      <select className="h-8 w-full rounded-md border bg-background px-2 text-xs" value={bow ?? ''} onChange={(e) => save(e.target.value || null)}>
        <option value="">No hunting bow</option>
        {HUNTING_BOWS.map((b) => {
          const blocker = bowBlocker(b, combatLevel, dexterity);
          return (
            <option key={b.name} value={b.name}>
              {b.name} · +{b.huntEff}% · CL {b.combatLevel} / DEX {b.dexterity}{blocker ? ` (${blocker})` : ''}
            </option>
          );
        })}
      </select>
      <p className="text-[11px] text-muted-foreground">The bow you swap in for hunting. Shown on the assault roster too.</p>
    </div>
  );
}

function PetCard({
  pet,
  setPet,
  profile,
  mastery,
  patted,
  setPatted,
  char,
  className,
}: {
  className?: string;
  pet: PetState;
  setPet: (p: Partial<PetState>) => void;
  profile: CombatProfile;
  mastery: number;
  patted: boolean;
  setPatted: (v: boolean) => void;
  char: ReturnType<typeof buildCharacterStats>;
}) {
  const species = Object.keys(PET_STATS);
  const eq = profile.equipped_pet;
  const owned = profile.pets ?? [];
  const ps = char.breakdown.pet;
  const pickOwned = (id: number) => {
    const p = owned.find((x) => x.id === id);
    if (p) setPet({ mode: 'sandbox', species: p.species, level: p.level, evolution: p.evolution ?? 0 });
  };
  return (
    <Card className={className}>
      <CardHeader className="pb-2 flex-row items-center gap-2 space-y-0">
        <CardTitle className="text-base">Pet</CardTitle>
        <div className="ml-auto flex gap-1">
          <Toggle on={pet.mode === 'profile'} onClick={() => setPet({ mode: 'profile' })}>Equipped</Toggle>
          <Toggle
            on={pet.mode === 'sandbox'}
            onClick={() => setPet({ mode: 'sandbox', species: pet.species ?? eq?.species ?? species[0], level: pet.species ? pet.level : eq?.level ?? 1 })}
          >
            <FlaskConical className="h-3 w-3 inline mr-1" />Sandbox
          </Toggle>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {pet.mode === 'profile' ? (
          eq ? (
            <div className="flex items-center gap-2 text-sm">
              {eq.image_url && <img src={eq.image_url} alt="" className="h-10 w-10 rounded" />}
              <div>
                <div className="font-medium">{eq.name}{eq.species && eq.species !== eq.name ? ` (${eq.species})` : ''}</div>
                <div className="text-xs text-muted-foreground">Lv {eq.level} · {eq.quality} · Evo {eq.evolution ?? 0}</div>
              </div>
              {!eq.species && <Badge variant="destructive" className="ml-auto">Unknown species</Badge>}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No pet equipped. Use Sandbox to try one.</p>
          )
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {owned.length > 0 && (
              <label className="space-y-1 block col-span-3">
                <span className="text-xs text-muted-foreground">From your pets</span>
                <Select value="" onChange={(v) => pickOwned(Number(v))}>
                  <option value="">Pick an owned pet…</option>
                  {owned.filter((p) => p.species).map((p) => (
                    <option key={p.id} value={p.id}>{p.name} · {p.species} Lv {p.level}</option>
                  ))}
                </Select>
              </label>
            )}
            <label className="space-y-1 block">
              <span className="text-xs text-muted-foreground">Species</span>
              <Select value={pet.species ?? ''} onChange={(v) => setPet({ species: v })}>
                {species.map((s) => <option key={s} value={s}>{s} · {PET_STATS[s].quality}</option>)}
              </Select>
            </label>
            <NumField label="Level" value={pet.level} min={1} max={100} onChange={(v) => setPet({ level: v ?? 1 })} />
            <NumField label="Evolution (0–5)" value={pet.evolution} min={0} max={5} onChange={(v) => setPet({ evolution: Math.min(5, Math.max(0, v ?? 0)) })} />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="outline">Mastery {mastery} · +{getPetMasteryBonus(mastery)}%</Badge>
          <Toggle on={patted} onClick={() => setPatted(!patted)}>Patted +5%</Toggle>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-1 text-center text-xs">
          {([['AP', ps.attackPower], ['Prot', ps.protection], ['Agi', ps.agility], ['Acc', ps.accuracy], ['Crit %', char.critChance.pet], ['Crit dmg', char.critDamage.pet]] as [string, number][]).map(([l, v]) => (
            <div key={l} className="rounded border py-1">
              <div className="text-muted-foreground text-[10px]">{l}</div>
              <div className="font-semibold">{v}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

const QUALITY_RING: Record<string, string> = {
  legendary: 'border-yellow-500/60 bg-yellow-500/5',
  mythic: 'border-orange-500/70 bg-orange-500/5',
};

function GearCard({
  catalog,
  gear,
  setGear,
  sandbox,
  setSandbox,
  combatLevel,
  gearStats,
  critDamage,
  critChance,
  className,
  footer,
}: {
  className?: string;
  /** Extra block under the gear totals (the optional hunting bow). */
  footer?: React.ReactNode;
  critChance: number;
  catalog: GearItem[];
  gear: GearSelection[];
  setGear: (g: GearSelection[]) => void;
  sandbox: boolean;
  setSandbox: (on: boolean) => void;
  combatLevel: number;
  gearStats: StatBlock;
  critDamage: number;
}) {
  const bySlot = new Map(gear.map((g) => [g.slot, g]));
  const equip = (slot: string, itemId: number | null) => setGear(equipGear(gear, slot, itemId));
  const setTier = (slot: string, tier: number) => setGear(gear.map((g) => (g.slot === slot ? { ...g, tier } : g)));

  return (
    <Card className={`${className ?? ''} ${sandbox ? 'border-amber-500/50' : ''}`}>
      <CardHeader className="pb-2 flex-row items-center gap-2 space-y-0">
        <CardTitle className="text-base">Gear</CardTitle>
        {sandbox && <Badge variant="outline" className="text-amber-400 border-amber-500/50">sandbox — not saved to character</Badge>}
        <div className="ml-auto flex gap-1">
          <Toggle on={!sandbox} onClick={() => setSandbox(false)}>My gear</Toggle>
          <Toggle on={sandbox} onClick={() => setSandbox(true)}><FlaskConical className="h-3 w-3 inline mr-1" />Sandbox</Toggle>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-[11px] text-muted-foreground">
          The API doesn&apos;t expose gear, so pick yours once under <b>My gear</b> (auto-saved). Catalog covers legendary/mythic (CL 60+);
          for anything else use Calibrate on the sheet.
        </p>
        <div className="grid gap-1.5">
          {GEAR_SLOTS.filter(({ key }) => slotVisible(key, gear)).map(({ key, label }) => {
            const sel = bySlot.get(key);
            const item = sel ? catalog.find((c) => c.id === sel.gear_item_id) : undefined;
            const maxTier = item?.max_tier ?? MAX_TIER[item?.quality ?? 'legendary'] ?? 16;
            const t = item && sel ? tieredGearStats(item, sel.tier) : null;
            const chips = t
              ? ([['AP', t.attackPower], ['Prot', t.protection], ['Agi', t.agility], ['Acc', t.accuracy], ['Crit %', t.critChance], ['Crit dmg', t.critDamage]] as [string, number][]).filter(([, v]) => v)
              : [];
            return (
              <div key={key} className={`flex items-center gap-2 rounded-md border p-1.5 ${item ? QUALITY_RING[item.quality] ?? '' : 'border-dashed'}`}>
                <div className="h-10 w-10 shrink-0 rounded bg-muted/40 flex items-center justify-center overflow-hidden">
                  {item?.image_url ? <img src={item.image_url} alt="" className="h-9 w-9 object-contain" /> : <span className="text-[10px] text-muted-foreground">{label}</span>}
                </div>
                <div className="flex-1 min-w-0 space-y-0.5">
                  <Select value={sel?.gear_item_id ?? ''} onChange={(v) => equip(key, v ? Number(v) : null)} className="h-7 text-xs">
                    <option value="">{label}: empty</option>
                    {catalog.filter((c) => c.slot === itemSlotOf(key)).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} · CL{c.combat_level}{c.combat_level > combatLevel ? ' 🔒' : ''}
                      </option>
                    ))}
                  </Select>
                  {chips.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {chips.map(([l, v]) => (
                        <span key={l} className="text-[10px] rounded bg-muted px-1">{l} {v}</span>
                      ))}
                    </div>
                  )}
                </div>
                {sel && (
                  <div className="flex items-center shrink-0 border rounded">
                    <button className="px-1.5 text-sm hover:bg-muted disabled:opacity-30" disabled={sel.tier <= 1} onClick={() => setTier(key, sel.tier - 1)}>−</button>
                    <span className="text-xs w-9 text-center font-medium">T{sel.tier}</span>
                    <button className="px-1.5 text-sm hover:bg-muted disabled:opacity-30" disabled={sel.tier >= maxTier} onClick={() => setTier(key, sel.tier + 1)}>+</button>
                    <button
                      className="px-1.5 text-[10px] font-semibold border-l hover:bg-muted disabled:opacity-30"
                      disabled={sel.tier >= maxTier}
                      onClick={() => setTier(key, maxTier)}
                      title={`Max tier (T${maxTier})`}
                    >
                      MAX
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="text-xs text-muted-foreground pt-1">
          Total: AP {gearStats.attackPower} · Prot {gearStats.protection} · Agi {gearStats.agility} · Acc {gearStats.accuracy}
          {critChance ? ` · Crit ${critChance}%` : ''}
          {critDamage ? ` · Crit dmg ${critDamage}` : ''}
        </div>
        {footer}
      </CardContent>
    </Card>
  );
}

const SLOT_ROWS = [
  { kind: 'attack', label: 'Attack', icon: '⚔' },
  { kind: 'protection', label: 'Protection', icon: '🛡' },
  { kind: 'combo', label: 'Both slots', icon: '✦' },
] as const;

const XP_ROWS = [
  { category: 'battle_xp', label: 'Battle XP', icon: '⭐' },
  { category: 'combat_xp', label: 'Combat XP', icon: '✧' },
] as const;

/** Short effect label for an XP potion chip (values filled in over time). */
const xpEffect = (p: XpPotionRow) =>
  [(p.xp_value || p.effect_value) > 0 && `+${p.xp_value || p.effect_value}% XP`, p.efficiency_value > 0 && `+${p.efficiency_value}% eff`]
    .filter(Boolean)
    .join(' · ');

const potionBonus = (p: PotionRow) =>
  [p.attack_power_bonus && `+${p.attack_power_bonus}% AP`, p.protection_bonus && `+${p.protection_bonus}% Prot`].filter(Boolean).join(' · ');

/**
 * Buffs: potions picked from the real in-game combinations (one attack slot + one protection slot,
 * combos fill both), starting from your default assault loadout. Siege buffs sit underneath.
 */
function BuffsCard({
  buffs,
  setBuffs,
  pickedIds,
  setPotionIds,
  potions,
  potionById,
  loadouts,
  myLoadout,
  differs,
  assaulter,
  presets,
  xpPotions,
  xpById,
  xpIds,
  setXpIds,
  applyPotions,
  onSaveLoadout,
  savingLoadout,
}: {
  assaulter: boolean;
  presets: PotionPreset[];
  xpPotions: XpPotionRow[];
  xpById: Map<number, XpPotionRow>;
  /** XP-slot potions picked (assaulters only). */
  xpIds: number[];
  setXpIds: (ids: number[]) => void;
  /** Put a whole preset / loadout in the slots (combat + XP). */
  applyPotions: (combatIds: number[], xpIds: number[]) => void;
  onSaveLoadout: (suggestedName: string) => void;
  savingLoadout: boolean;
  buffs: BuffState;
  setBuffs: (b: BuffState) => void;
  /** null = an old setup whose potion % matches no real potion */
  pickedIds: number[] | null;
  setPotionIds: (ids: number[]) => void;
  potions: PotionRow[];
  potionById: Map<number, PotionRow>;
  loadouts: PotionLoadout[];
  myLoadout: PotionLoadout | null;
  differs: boolean;
}) {
  const set = (p: Partial<BuffState>) => setBuffs({ ...buffs, ...p });
  const ids = pickedIds ?? [];
  const picked = ids.map((id) => potionById.get(id)).filter((p): p is PotionRow => !!p);
  const combo = picked.find((p) => kindOf(p) === 'combo') ?? null;
  const rows = SLOT_ROWS.map((r) => ({
    ...r,
    items: potions
      .filter((p) => kindOf(p) === r.kind)
      .sort((a, b) => a.attack_power_bonus + a.protection_bonus - (b.attack_power_bonus + b.protection_bonus)),
  })).filter((r) => r.items.length);
  // A loadout / preset is "on" when combat slots match, and (assaulters) XP slots too.
  const keyOf = (c: number[], x: number[]) =>
    `${potionKey(legalPotionIds(c, potionById))}|${assaulter ? potionKey(legalXpIds(x, xpById)) : ''}`;
  const loadoutKey = (l: PotionLoadout) => keyOf(l.combat_potion_ids, l.xp_potion_ids ?? []);
  const activeKey = pickedIds ? keyOf(pickedIds, xpIds) : null;
  const myLoadoutIds = myLoadout ? legalPotionIds(myLoadout.combat_potion_ids, potionById) : [];
  const activePreset = presets.find((p) => activeKey === keyOf(p.combat_potion_ids, p.xp_potion_ids));
  const matchesSaved = loadouts.some((l) => l.source === 'web' && activeKey === loadoutKey(l));
  const xpPicked = xpIds.map((id) => xpById.get(id)).filter((p): p is XpPotionRow => !!p);
  const xpRows = assaulter
    ? XP_ROWS.map((r) => ({ ...r, items: xpPotions.filter((p) => p.category === r.category) })).filter((r) => r.items.length)
    : [];

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Buffs</CardTitle>
          {myLoadout || ids.length ? (
            differs ? (
              <button
                type="button"
                className="text-xs text-amber-400 hover:underline"
                onClick={() => applyPotions(myLoadoutIds, myLoadout?.xp_potion_ids ?? [])}
                title="Put your current assault loadout back in the slots"
              >
                {myLoadout ? `Differs from ${myLoadout.name} · reset` : 'Clear potions'}
              </button>
            ) : (
              <span className="text-xs text-muted-foreground">
                <span className="text-green-500">✓</span> Your assault loadout{myLoadout ? <> · <b className="text-foreground">{myLoadout.name}</b></> : null}
              </span>
            )
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* saved loadouts */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground mr-1">Loadouts</span>
          {loadouts.map((l) => {
            const lIds = legalPotionIds(l.combat_potion_ids, potionById);
            const on = activeKey === loadoutKey(l);
            return (
              <button
                key={l.id}
                type="button"
                onClick={() => applyPotions(lIds, l.xp_potion_ids ?? [])}
                title={`${l.name}${l.is_default ? ' (current assault loadout)' : ''}${l.source === 'discord' ? ' · from Discord' : ''}: ${lIds.map((id) => potionById.get(id)?.name).join(' + ') || 'no combat potions'}`}
                className={`inline-flex items-center gap-1 rounded-full border pl-1.5 pr-2 py-0.5 text-xs transition-colors ${
                  on ? 'border-primary bg-primary/10 text-foreground' : 'hover:bg-muted text-muted-foreground'
                }`}
              >
                {lIds.length ? (
                  <span className="flex -space-x-1.5">
                    {lIds.map((id) => <PotionIcon key={id} p={potionById.get(id)} className="h-4 w-4 ring-1 ring-background" />)}
                  </span>
                ) : null}
                {l.name}
                {l.is_default && <span className="text-[10px] text-crystal">current</span>}
              </button>
            );
          })}
          <Link href="/assault/potions" className="text-xs text-muted-foreground hover:text-foreground hover:underline ml-1">
            {loadouts.length ? 'Edit' : 'No saved loadout yet · make one'}
          </Link>
        </div>

        {/* assault presets: assaulters take the whole preset, XP slots included */}
        {assaulter && presets.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground mr-1">Assault presets</span>
            {presets.map((p) => {
              const cIds = legalPotionIds(p.combat_potion_ids, potionById);
              const xIds = legalXpIds(p.xp_potion_ids, xpById);
              const names = [...cIds.map((id) => potionById.get(id)?.name), ...xIds.map((id) => xpById.get(id)?.name)].filter(Boolean);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => applyPotions(cIds, xIds)}
                  title={`${p.label} preset: ${names.join(' + ') || 'no potions'}`}
                  className={`inline-flex items-center gap-1 rounded-full border pl-1.5 pr-2 py-0.5 text-xs transition-colors ${
                    activePreset?.id === p.id ? 'border-primary bg-primary/10 text-foreground' : 'hover:bg-muted text-muted-foreground'
                  }`}
                >
                  {cIds.length + xIds.length ? (
                    <span className="flex -space-x-1.5">
                      {cIds.map((id) => <PotionIcon key={`c${id}`} p={potionById.get(id)} className="h-4 w-4 ring-1 ring-background" />)}
                      {xIds.map((id) => <PotionIcon key={`x${id}`} p={xpById.get(id)} className="h-4 w-4 ring-1 ring-background" />)}
                    </span>
                  ) : null}
                  {p.label}
                  {p.id === RECOMMENDED_PRESET_ID && <span className="text-[10px] text-amber-400">★</span>}
                </button>
              );
            })}
          </div>
        )}

        {/* slots */}
        <div className="rounded-md border divide-y">
          {rows.map((r) => {
            const slotTaken = r.kind !== 'combo' && combo;
            const slotFilled = r.kind !== 'combo' && picked.some((p) => kindOf(p) === r.kind);
            return (
              <div key={r.kind} className="flex items-start gap-2 px-2 py-1.5">
                <span className="w-20 shrink-0 pt-1 text-xs text-muted-foreground">
                  {r.icon} {r.label}
                </span>
                <div className="flex flex-wrap gap-1">
                  {r.kind !== 'combo' && (
                    <PotionChip
                      on={!slotFilled && !slotTaken}
                      onClick={() => setPotionIds(clearSlot(ids, r.kind, potionById))}
                    >
                      <span className="text-muted-foreground">None</span>
                    </PotionChip>
                  )}
                  {r.items.map((p) => (
                    <PotionChip
                      key={p.id}
                      on={ids.includes(p.id)}
                      dim={!!slotTaken}
                      onClick={() => setPotionIds(togglePotion(ids, p, potionById))}
                      title={`${p.name} · ${potionBonus(p)}${p.duration_minutes ? ` · ${p.duration_minutes} min` : ''}${slotTaken ? ` · replaces ${combo!.name}` : ''}`}
                    >
                      <PotionIcon p={p} className="h-4 w-4" />
                      <span>{p.name}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {r.kind === 'combo' ? `${p.attack_power_bonus}/${p.protection_bonus}%` : `+${p.attack_power_bonus || p.protection_bonus}%`}
                      </span>
                    </PotionChip>
                  ))}
                  {slotTaken && <span className="self-center text-[10px] text-muted-foreground">in use by {combo!.name}</span>}
                </div>
              </div>
            );
          })}
          {xpRows.map((r) => {
            const inSlot = xpPicked.find((p) => p.category === r.category);
            return (
              <div key={r.category} className="flex items-start gap-2 px-2 py-1.5">
                <span className="w-20 shrink-0 pt-1 text-xs text-muted-foreground">
                  {r.icon} {r.label}
                </span>
                <div className="flex flex-wrap gap-1">
                  <PotionChip on={!inSlot} onClick={() => setXpIds(xpIds.filter((id) => xpById.get(id)?.category !== r.category))}>
                    <span className="text-muted-foreground">None</span>
                  </PotionChip>
                  {r.items.map((p) => {
                    const clash = xpPicked.find((o) => o.category !== p.category && o.efficiency_value > 0 && p.efficiency_value > 0);
                    return (
                      <PotionChip
                        key={p.id}
                        on={xpIds.includes(p.id)}
                        dim={!!clash}
                        onClick={() => setXpIds(toggleXp(xpIds, p, xpById))}
                        title={`${p.name}${p.description ? ` · ${p.description}` : ''}${p.duration_minutes ? ` · ${p.duration_minutes} min` : ''}${clash ? ` · replaces ${clash.name} (both hunting efficiency)` : ''}`}
                      >
                        <PotionIcon p={p} className="h-4 w-4" />
                        <span>{p.name}</span>
                        {xpEffect(p) && <span className="text-[10px] text-muted-foreground">{xpEffect(p)}</span>}
                      </PotionChip>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        <div className="text-xs text-muted-foreground">
          {pickedIds == null ? (
            <span className="text-amber-400">
              This setup has +{buffs.apPotionPct}% AP / +{buffs.protPotionPct}% Prot, which no potion combination gives. Pick potions to replace it.
            </span>
          ) : picked.length ? (
            <>Potions: <b className="text-foreground">+{buffs.apPotionPct}% AP · +{buffs.protPotionPct}% Prot</b></>
          ) : (
            'No potions.'
          )}
          {xpPicked.length > 0 && <> · XP: <b className="text-foreground">{xpPicked.map((p) => p.name).join(' + ')}</b></>}
          {assaulter && pickedIds != null && (picked.length > 0 || xpPicked.length > 0) && !matchesSaved && (
            <button
              type="button"
              disabled={savingLoadout}
              onClick={() => onSaveLoadout(activePreset ? `${activePreset.label} loadout` : 'My loadout')}
              className="ml-2 text-primary hover:underline disabled:opacity-50"
              title="Save these potions as your assault loadout: shows on /assault/potions, Discord and the roster"
            >
              {savingLoadout ? 'Saving…' : 'Save as my assault loadout'}
            </button>
          )}
        </div>

        {/* siege buffs */}
        <div className="flex flex-wrap items-center gap-1.5 border-t pt-3">
          <span className="text-xs text-muted-foreground mr-1">🏰 Siege</span>
          <Toggle on={buffs.scorpion} onClick={() => set({ scorpion: !buffs.scorpion })}>Scorpion +100 AP</Toggle>
          <Toggle on={buffs.keg} onClick={() => set({ keg: !buffs.keg })}>Keg +10% AP</Toggle>
          <Toggle on={buffs.medTent} onClick={() => set({ medTent: !buffs.medTent })}>Med tent +50 Prot</Toggle>
          <Toggle on={buffs.medKit} onClick={() => set({ medKit: !buffs.medKit })}>Med kit +10% Prot</Toggle>
        </div>
      </CardContent>
    </Card>
  );
}

function PotionChip({
  on,
  dim,
  onClick,
  title,
  children,
}: {
  on: boolean;
  dim?: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={on}
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs transition-colors ${
        on ? 'border-primary bg-primary/10 text-foreground' : `hover:bg-muted ${dim ? 'opacity-50' : ''}`
      }`}
    >
      {children}
    </button>
  );
}

function PotionIcon({ p, className }: { p: { image_url: string | null } | undefined; className?: string }) {
  if (!p?.image_url) return <span className={`inline-block rounded-full bg-muted ${className ?? ''}`} />;
  return <img src={p.image_url} alt="" className={`rounded-full bg-background object-contain ${className ?? ''}`} />;
}

/** Breakpoint goals — same defaults as the original calculator. */
interface BpTargets {
  hitChance: number;
  enemyHitChance: number;
  enemyDamage: number;
}
const RECOMMENDED_BP: BpTargets = { hitChance: 75, enemyHitChance: 25, enemyDamage: 100 };

function GoalInput({
  value,
  rec,
  suffix,
  onChange,
  min,
  max,
}: {
  value: number;
  rec: number;
  suffix?: string;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
}) {
  const changed = value !== rec;
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`inline-flex items-center rounded border h-6 ${changed ? 'border-amber-500/50' : 'border-border/60'}`}>
        <input
          type="number"
          className="w-11 bg-transparent px-1 text-xs outline-none text-right"
          value={value}
          min={min}
          max={max}
          onChange={(e) => onChange(Number(e.target.value) || 0)}
        />
        {suffix && <span className="pr-1 text-[10px] text-muted-foreground">{suffix}</span>}
      </span>
      {changed ? (
        <button className="text-[10px] text-amber-400 hover:underline" onClick={() => onChange(rec)} title={`Back to recommended (${rec}${suffix ?? ''})`}>
          ↺
        </button>
      ) : (
        <span className="text-[10px] text-muted-foreground/70" title="Recommended default">rec</span>
      )}
    </span>
  );
}

function BreakpointsPanel({
  fighter,
  base,
  buffs,
  target,
  hits,
  targets,
  setTargets,
  meta,
}: {
  fighter: StatBlock & { critChance: number; critDamage: number; damageFlat: number };
  base: StatBlock;
  buffs: BuffState;
  target: { level: number; hp: number; slayerPct: number };
  hits: number | null;
  targets: BpTargets;
  setTargets: (t: BpTargets) => void;
  meta?: React.ReactNode;
}) {
  const L = target.level;
  const apPct = buffs.apPotionPct + (buffs.keg ? 10 : 0);
  const apFlat = buffs.scorpion ? 100 : 0;
  const protPct = buffs.protPotionPct + (buffs.medKit ? 10 : 0);
  const protFlat = buffs.medTent ? 50 : 0;

  // 2 hits is the 3s floor — more AP past that doesn't speed kills up.
  let hitsLine: React.ReactNode = '—';
  if (hits != null) {
    if (hits <= 2) {
      hitsLine = <span className="text-green-500">✓ at the 3s/kill floor</span>;
    } else {
      const next = hits - 1;
      const hc = Math.min(100, (fighter.accuracy / (fighter.accuracy + enemyPower(L))) * 100);
      const needAP = findAPForHits(next, target.hp, hc, fighter.critChance, fighter.critDamage, L, fighter.damageFlat, target.slayerPct, fighter.attackPower);
      const needBase = Math.ceil((needAP - apFlat) / (1 + apPct / 100));
      const dmg = matchup(fighter, target, target.slayerPct).damage;
      const neededHc = ((target.hp / next) * 100) / dmg;
      const accNote = neededHc > 100 ? 'accuracy alone can’t reach it' : `or ${fmt(accuracyForHitChance(neededHc, L))} Acc (+${fmt(Math.max(0, accuracyForHitChance(neededHc, L) - fighter.accuracy))})`;
      hitsLine = `${hits}→${next} hits: +${fmt(needAP - fighter.attackPower)} AP (+${fmt(Math.max(0, needBase - base.attackPower))} base), ${accNote}`;
    }
  }
  const accNeed = accuracyForHitChance(targets.hitChance, L) - fighter.accuracy;
  const agiNeed = agilityForEnemyHitChance(targets.enemyHitChance, L) - fighter.agility;
  const protNeed = protectionForEnemyDamage(targets.enemyDamage, L);
  const protBaseNeed = Math.ceil((protNeed - protFlat) / (1 + protPct / 100));
  const set = (p: Partial<BpTargets>) => setTargets({ ...targets, ...p });

  const ok = (t: string) => <span className="text-green-500">✓ {t}</span>;
  const rows: [string, React.ReactNode, React.ReactNode][] = [
    [
      'Hit chance',
      accNeed <= 0 ? ok('reached') : <>+{fmt(accNeed)} Acc</>,
      <GoalInput key="hc" value={targets.hitChance} rec={RECOMMENDED_BP.hitChance} suffix="%" min={1} max={99} onChange={(v) => set({ hitChance: v })} />,
    ],
    [
      'Enemy hit',
      targets.enemyHitChance < 10 ? 'min 10%' : agiNeed <= 0 ? ok('reached') : <>+{fmt(agiNeed)} Agi</>,
      <GoalInput key="ehc" value={targets.enemyHitChance} rec={RECOMMENDED_BP.enemyHitChance} suffix="%" min={10} max={99} onChange={(v) => set({ enemyHitChance: v })} />,
    ],
    [
      'Dmg taken ≤',
      protNeed <= fighter.protection
        ? ok('reached')
        : <span title={`${fmt(protNeed)} Protection needed (+${fmt(Math.max(0, protBaseNeed - base.protection))} base)`}>+{fmt(protNeed - fighter.protection)} Prot</span>,
      <GoalInput key="edmg" value={targets.enemyDamage} rec={RECOMMENDED_BP.enemyDamage} min={1} onChange={(v) => set({ enemyDamage: Math.max(1, v) })} />,
    ],
  ];

  return (
    <div className="space-y-1.5 text-xs pr-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span><span className="text-muted-foreground">Next hit </span>{hitsLine}</span>
        {meta && <span className="text-muted-foreground flex items-center">{meta}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
        {rows.map(([label, text, input]) => (
          <span key={label} className="inline-flex items-center gap-1.5">
            <span className="text-muted-foreground">{label}</span>
            {input}
            <span className="text-foreground">{text}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Slayer % in the zone table. Assaulters can click it to try another value (sandbox, amber). */
function SlayerCell({ pct, real, onChange }: { pct: number; real: number; onChange?: (v: number | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const sandboxed = pct !== real;
  const label = pct ? `+${pct}%` : '—';
  if (!onChange) return <>{label}</>;
  const commit = () => {
    setEditing(false);
    const n = draft.trim() === '' ? null : Number(draft);
    onChange(n == null || !Number.isFinite(n) ? null : Math.max(0, Math.min(1000, n)));
  };
  if (editing) {
    return (
      <span className="inline-flex items-center animate-in fade-in duration-100" onClick={(e) => e.stopPropagation()}>
        <span className="text-muted-foreground">+</span>
        <input
          autoFocus
          type="number"
          min={0}
          step="any"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => e.target.select()}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') setEditing(false);
          }}
          className="w-10 bg-transparent text-sm outline-none border-b border-amber-500/50 text-amber-400 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <span className="text-muted-foreground">%</span>
      </span>
    );
  }
  return (
    <span
      role="button"
      tabIndex={0}
      title={sandboxed ? `Sandbox slayer (yours: ${real ? `+${real}%` : 'none'}). Click to edit, clear to reset.` : 'Click to try another slayer %'}
      onClick={(e) => {
        e.stopPropagation();
        setDraft(String(pct || ''));
        setEditing(true);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          setDraft(String(pct || ''));
          setEditing(true);
        }
      }}
      className={`cursor-text rounded px-0.5 -mx-0.5 transition-colors decoration-dotted underline-offset-2 hover:underline hover:decoration-muted-foreground/60 ${sandboxed ? 'text-amber-400 underline decoration-amber-500/50' : ''}`}
    >
      {label}
    </span>
  );
}

type Resolver = (e: Enemy) => { level: number; hp: number; slayerPct: number };

/**
 * Enemy scaling: CL < 80 none; CL 80–99 a single toggle to your own CL;
 * CL 100+ any level 100–150 (milestones, ±10, slider).
 */
function ScalingControl({
  scale,
  combatLevel,
  value,
  onChange,
}: {
  scale: { allowed: boolean; max: number };
  combatLevel: number;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  const label = <span className="text-xs text-muted-foreground block mb-1">Enemy scaling</span>;
  if (!scale.allowed) {
    return (
      <div>
        {label}
        <span className="text-xs text-muted-foreground">Unlocks at CL 80 (you&apos;re {combatLevel})</span>
      </div>
    );
  }
  if (combatLevel < 100) {
    const on = value != null;
    return (
      <div>
        {label}
        <Toggle on={on} onClick={() => onChange(on ? null : combatLevel)}>
          {on ? `Scaled to ${combatLevel}` : `Scale to my level (${combatLevel})`}
        </Toggle>
      </div>
    );
  }
  const MIN = 100;
  const MAX = 150;
  const v = value != null ? Math.min(MAX, Math.max(MIN, value)) : null;
  const set = (n: number) => onChange(Math.min(MAX, Math.max(MIN, n)));
  const step = 'h-7 w-8 rounded border text-xs hover:bg-muted disabled:opacity-30';
  return (
    <div className="w-72">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-muted-foreground">Enemy scaling</span>
        <span className="text-xs">
          {v != null ? <b className="text-amber-400">Lv {v}</b> : <span className="text-muted-foreground">off</span>}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <Toggle on={v == null} onClick={() => onChange(null)}>Off</Toggle>
        {[100, 120, 150].map((m) => (
          <Toggle key={m} on={v === m} onClick={() => set(m)}>{m}</Toggle>
        ))}
        <span className="ml-auto flex gap-1">
          <button className={step} disabled={v == null || v <= MIN} onClick={() => set((v ?? MIN) - 10)}>−10</button>
          <button className={step} disabled={v != null && v >= MAX} onClick={() => set((v ?? MIN - 10) + 10)}>+10</button>
        </span>
      </div>
      <input
        type="range"
        min={MIN}
        max={MAX}
        step={1}
        value={v ?? MIN}
        onChange={(e) => set(Number(e.target.value))}
        className={`w-full mt-1.5 accent-amber-500 ${v == null ? 'opacity-40' : ''}`}
      />
    </div>
  );
}

function ZoneSweep({
  zones,
  zoneId,
  onZone,
  enemies,
  resolve,
  fighter,
  selectedId,
  onSelect,
  scale,
  scaledLevel,
  onScale,
  combatLevel,
  realSlayer,
  onSlayer,
  detail,
}: {
  detail?: React.ReactNode;
  realSlayer: Record<number, number>;
  /** Present = slayer % is sandboxable (DE/DI). */
  onSlayer?: (enemyId: number, pct: number | null) => void;
  zones: [number, string][];
  zoneId: number | null;
  onZone: (zid: number) => void;
  enemies: Enemy[];
  resolve: Resolver;
  fighter: StatBlock & { critChance: number; critDamage: number; damageFlat: number };
  selectedId: number | null;
  onSelect: (id: number) => void;
  scale: { allowed: boolean; max: number };
  scaledLevel: number | null;
  onScale: (v: number | null) => void;
  combatLevel: number;
}) {
  const [openId, setOpenId] = useState<number | null>(selectedId);
  const clickRow = (id: number) => {
    if (id === selectedId && openId === id) setOpenId(null);
    else {
      onSelect(id);
      setOpenId(id);
    }
  };

  const rows = enemies.map((e) => {
    const t = resolve(e);
    const m = matchup(fighter, t, t.slayerPct);
    let nextAp: number | null = null;
    if (m.hits && m.hits > 2) {
      nextAp = findAPForHits(m.hits - 1, t.hp, m.hitChance, fighter.critChance, fighter.critDamage, t.level, fighter.damageFlat, t.slayerPct, fighter.attackPower) - fighter.attackPower;
    }
    return { e, t, m, nextAp };
  });
  const bucket = (h: number | null) => (h == null ? 'x' : h <= 2 ? '2' : h === 3 ? '3' : h <= 5 ? '45' : 'x');
  const counts = rows.reduce<Record<string, number>>((acc, r) => ((acc[bucket(r.m.hits)] = (acc[bucket(r.m.hits)] ?? 0) + 1), acc), {});
  const tone = (h: number | null) =>
    h == null ? 'bg-muted text-muted-foreground' : h <= 2 ? 'bg-green-500/20 text-green-500' : h === 3 ? 'bg-lime-500/20 text-lime-400' : h <= 5 ? 'bg-amber-500/20 text-amber-400' : 'bg-red-500/20 text-red-500';

  const tableEl = (_compact: boolean) => (
    rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No enemies in this zone.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="text-left">
                <th className="py-1 pr-2">Enemy</th><th className="pr-2">Lv</th><th className="pr-2">HP</th><th className="pr-2">Hits</th>
                <th className="pr-2">s/kill</th><th className="pr-2">Kills/h</th><th className="pr-2">Your dmg</th><th className="pr-2">Hit %</th>
                <th className="pr-2">Taken/hit</th><th className="pr-2">Enemy hit %</th><th className="pr-2">Slayer</th><th>Next hit</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ e, t, m, nextAp }) => {
                const selected = selectedId === e.id;
                const expanded = openId === e.id && selected && !!detail;
                const accent = '';
                return (
                <Fragment key={e.id}>
                <tr
                  className={`border-t border-border/40 cursor-pointer transition-colors ${selected ? 'bg-muted/50' : 'hover:bg-muted/25'}`}
                  onClick={() => clickRow(e.id)}
                >
                  <td className={`py-1.5 pr-2 pl-2 rounded-l-md ${accent}`}>
                    <div className="flex items-center gap-2">
                      {e.image_url && <img src={e.image_url} alt="" className="h-7 w-7" />}
                      <span className="font-medium">{e.name}</span>
                    </div>
                  </td>
                  <td className="pr-2">{t.level}{t.level !== e.level && <span className="text-[10px] text-muted-foreground"> ({e.level})</span>}</td>
                  <td className="pr-2">{fmt(t.hp)}</td>
                  <td className="pr-2"><span className={`inline-block min-w-[2rem] text-center rounded font-bold px-1.5 py-0.5 ${tone(m.hits)}`}>{m.hits ?? '—'}</span></td>
                  <td className="pr-2">{m.secondsPerKill?.toFixed(2) ?? '—'}</td>
                  <td className="pr-2">{m.secondsPerKill ? fmt(3600 / m.secondsPerKill) : '—'}</td>
                  <td className="pr-2">{fmt(m.damage)}</td>
                  <td className="pr-2">{m.hitChance.toFixed(1)}</td>
                  <td className="pr-2">{fmt(m.enemyDamage)}</td>
                  <td className="pr-2">{m.enemyHitChance.toFixed(1)}</td>
                  <td className="pr-2">
                    <SlayerCell pct={t.slayerPct} real={realSlayer[e.id] ?? 0} onChange={onSlayer && ((v) => onSlayer(e.id, v))} />
                  </td>
                  <td className="text-xs text-muted-foreground">
                    {nextAp != null ? `+${fmt(nextAp)} AP` : m.hits != null && m.hits <= 2 ? <span className="text-green-500">✓ capped</span> : ''}
                  </td>
                </tr>
                {expanded && (
                  <tr className="bg-muted/50">
                    <td colSpan={12} className={`px-3 pb-2 pt-0.5 ${accent}`}>
                      <div className="relative animate-in fade-in slide-in-from-top-1 duration-150">
                        <button
                          className="absolute right-0 top-0 rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted"
                          title="Collapse"
                          onClick={() => setOpenId(null)}
                        >
                          <X className="h-4 w-4" />
                        </button>
                        {detail}
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
                );
              })}
            </tbody>
          </table>
        )
  );

  return (
    <>
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <CardTitle className="text-lg">Zone sweep</CardTitle>
            <CardDescription>Every enemy in the zone with your current setup. Aim for 2–3 hits; past 5 isn&apos;t worth farming. Click a row for breakpoints, click again to collapse.</CardDescription>
          </div>
          <div className="flex flex-wrap items-end gap-2 ml-auto">
            <label className="space-y-1 block w-56">
              <span className="text-xs text-muted-foreground">Zone</span>
              <Select value={zoneId ?? ''} onChange={(v) => onZone(Number(v))}>
                {zones.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </Select>
            </label>
            <ScalingControl scale={scale} combatLevel={combatLevel} value={scaledLevel} onChange={onScale} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs pt-1">
          <span className="rounded px-2 py-0.5 bg-green-500/20 text-green-500">{counts['2'] ?? 0} in ≤2 hits</span>
          <span className="rounded px-2 py-0.5 bg-lime-500/20 text-lime-400">{counts['3'] ?? 0} in 3</span>
          <span className="rounded px-2 py-0.5 bg-amber-500/20 text-amber-400">{counts['45'] ?? 0} in 4–5</span>
          <span className="rounded px-2 py-0.5 bg-red-500/20 text-red-500">{counts['x'] ?? 0} over 5</span>
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {tableEl(false)}
      </CardContent>
    </Card>
    </>
  );
}

function PotionAdvisor({
  enemies,
  resolve,
  counts,
  setCounts,
  base,
  buffs,
  critChance,
  critDamage,
  damageFlat,
  potions,
  onUse,
  maxHp,
  food,
  marketAccess,
  characterClass,
}: {
  marketAccess: boolean;
  characterClass: string | null;
  enemies: Enemy[];
  resolve: Resolver;
  counts: Record<number, number>;
  setCounts: (c: Record<number, number>) => void;
  base: StatBlock;
  buffs: BuffState;
  critChance: number;
  critDamage: number;
  damageFlat: number;
  potions: PotionRow[];
  onUse: (ids: number[]) => void;
  maxHp: number | null;
  food: Food;
}) {
  // No-market classes can only use potions they brew or loot: show everything, unpriced.
  const [includeUntradeable, setIncludeUntradeable] = useState(!marketAccess);
  const [bulk, setBulk] = useState<number | null>(null);

  const advisorPotions: AdvisorPotion[] = potions
    .filter((p) => includeUntradeable || p.is_tradeable)
    .map((p) => ({
      id: p.id,
      name: p.name,
      quality: p.quality,
      attack_power_bonus: p.attack_power_bonus,
      protection_bonus: p.protection_bonus,
      duration_minutes: p.duration_minutes,
      price: marketAccess && p.is_tradeable ? Number(p.avg_recent_sales ?? p.market_price ?? 0) || null : 0,
      image_url: p.image_url,
    }));

  const stack = enemies
    .map((e) => ({ e, n: counts[e.id] ?? 0 }))
    .filter((x) => x.n > 0)
    .map(({ e, n }) => ({ id: e.id, name: e.name, count: n, ...resolve(e) }));

  const res = stack.length
    ? runAdvisor({
        base,
        critChance,
        critDamage,
        damageFlat,
        // Potion % comes from each candidate; keep siege buffs only.
        buffs: { ...buffs, apPotionPct: 0, protPotionPct: 0 },
        enemies: stack,
        potions: advisorPotions,
      })
    : null;

  const perBattle = (o: AdvisorOption) => (res && res.totalKills ? (o.totalDamageTaken / res.totalKills) * 6 : 0);
  const foodFor = (o: AdvisorOption) => {
    if (!maxHp) return null;
    const need = perBattle(o) - maxHp;
    return need > 0 ? Math.ceil(need / food.hp) : 0;
  };

  const Row = ({ o, tag }: { o: AdvisorOption; tag?: string }) => (
    <tr className="border-t">
      <td className="py-1.5 pr-2">
        {tag && <Badge className="mr-1.5" variant="secondary">{tag}</Badge>}
        {o.isCombo ? o.attackPotion!.name : [o.attackPotion?.name, o.protectionPotion?.name].filter(Boolean).join(' + ') || 'No potions'}
      </td>
      <td className="pr-2">{fmt(o.attackPower)} / {fmt(o.protection)}</td>
      <td className="pr-2">{formatDuration(o.totalSeconds)}{o.secondsSaved > 0.5 && <span className="text-green-500 text-xs ml-1">−{formatDuration(o.secondsSaved)}</span>}</td>
      <td className="pr-2">{o.breakpointsGained ? `−${fmt(o.breakpointsGained)}` : '—'}</td>
      <td className="pr-2">{fmt(perBattle(o))}{foodFor(o) != null && <span className="text-xs text-muted-foreground ml-1">({foodFor(o)} {food.name.replace('Cooked ', '')} ≈ {gold((foodFor(o) ?? 0) * food.price)})</span>}</td>
      <td className="pr-2 text-xs">{o.quantities.map((q) => `${q.qty}× ${q.potion.name}`).join(', ') || '—'}</td>
      <td className="text-right">{o.cost ? gold(o.cost) : '—'}</td>
    </tr>
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2"><Shield className="h-4 w-4" />Potion advisor</CardTitle>
        <CardDescription>
          Enter how many hunted (not yet fled) enemies you have to battle. Tests every legal potion setup (one attack slot + one protection
          slot; combo potions use both) and counts potions by battle time ÷ duration. Siege buffs above are kept; Use puts a pick in your potion slots.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!marketAccess && (
          <p className="text-xs text-amber-400">
            {characterClass} has no market access, so potions are shown without prices (brew or loot your own). &quot;Best value&quot; is skipped.
          </p>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <NumField label="Set all to" value={bulk} onChange={setBulk} className="w-28" />
          <Button size="sm" variant="outline" onClick={() => setCounts(Object.fromEntries(enemies.map((e) => [e.id, bulk ?? 0])))}>Apply</Button>
          <Button size="sm" variant="ghost" onClick={() => setCounts({})}>Clear</Button>
          <label className="flex items-center gap-1 text-xs ml-auto cursor-pointer">
            <input type="checkbox" checked={includeUntradeable} onChange={(e) => setIncludeUntradeable(e.target.checked)} />
            Include untradeable (free) potions
          </label>
        </div>
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {enemies.map((e) => (
            <NumField key={e.id} label={`${e.name} (Lv ${e.level})`} value={counts[e.id] ?? null} min={0} onChange={(v) => setCounts({ ...counts, [e.id]: Math.max(0, v ?? 0) })} />
          ))}
        </div>

        {res ? (
          <>
            <div className="grid gap-2 sm:grid-cols-3 text-sm">
              <Pick onUse={onUse} title="Fastest" o={res.fastest} total={res.baseline.totalSeconds} />
              <Pick onUse={onUse} title="Best value" o={res.bestValue} total={res.baseline.totalSeconds} />
              <Pick onUse={onUse} title="Least damage" o={res.tankiest} total={res.baseline.totalSeconds} />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground text-left">
                  <tr><th className="py-1 pr-2">Setup</th><th className="pr-2">AP / Prot</th><th className="pr-2">Battle time</th><th className="pr-2">Hits saved</th><th className="pr-2">Dmg / 6-stack</th><th className="pr-2">Need</th><th className="text-right">Cost</th></tr>
                </thead>
                <tbody>
                  <Row o={res.baseline} tag="baseline" />
                  {res.options.slice(0, 12).map((o) => <Row key={o.key} o={o} />)}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {fmt(res.totalKills)} kills. Time per kill comes from the assault guide (2 hits = 3.00s … 5 hits = 7.23s). Damage per 6-stack is the
              average damage you take per full battle{maxHp ? ` vs your ${fmt(maxHp)} HP` : ' (add Max HP on the sheet to see how much food you need)'}.
              Setups that are slower and pricier than another are hidden.
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Add enemy counts to get suggestions.</p>
        )}
      </CardContent>
    </Card>
  );
}

function Pick({ title, o, total, onUse }: { title: string; o: AdvisorOption | null; total: number; onUse: (ids: number[]) => void }) {
  const ids = o ? Array.from(new Set([o.attackPotion?.id, o.protectionPotion?.id].filter((x): x is number => x != null))) : [];
  return (
    <div className="rounded-md border p-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        {title}
        {o && ids.length > 0 && (
          <button type="button" className="hover:text-foreground hover:underline" onClick={() => onUse(ids)} title="Put these potions in your Buffs slots">
            Use
          </button>
        )}
      </div>
      {o ? (
        <>
          <div className="font-semibold">{o.isCombo ? o.attackPotion!.name : [o.attackPotion?.name, o.protectionPotion?.name].filter(Boolean).join(' + ')}</div>
          <div className="text-xs text-muted-foreground">
            {o.secondsSaved > 0.5 ? `saves ${formatDuration(o.secondsSaved)} (${Math.round((o.secondsSaved / total) * 100)}%)` : `−${fmt(o.damageSaved)} dmg taken`} · {o.cost ? gold(o.cost) : 'free'}
          </div>
        </>
      ) : (
        <div className="text-xs text-muted-foreground">Nothing helps here.</div>
      )}
    </div>
  );
}
