'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertTriangle, Check, ChevronDown, ChevronRight, EyeOff, FlaskConical, Loader2, MapPin, PawPrint, RefreshCw, Swords, Target, Users, X,
} from 'lucide-react';
import type { Participation, Roster, RosterGuild, RosterPotion, RosterRow } from '@/lib/assault-roster';
import { HUNTING_BOWS, bowBlocker } from '@/lib/combat/hunting-gear';
import type { GoalSet } from '@/lib/roster-goals';
import { GoalsSection, GoalsView, SetupEligibility } from '@/components/assault/RosterGoals';
import { evaluateGoals, meetsMinimum } from '@/lib/roster-goals';

interface Payload {
  guilds: RosterGuild[];
  guild: RosterGuild;
  roster: Roster;
  mine: string[];
  goals: GoalSet;
  canEditGoals: boolean;
}

/** In-game rarity colours (Legendary/Mythic match the gear colours on /combat). */
const TIER_CLASS: Record<string, string> = {
  Standard: 'text-zinc-400',
  Refined: 'text-sky-500',
  Premium: 'text-green-500',
  Epic: 'text-red-500',
  Event: 'text-pink-400',
  Legendary: 'text-yellow-500',
  Mythic: 'text-orange-500',
};
const TIER_ORDER = ['Mythic', 'Legendary', 'Epic', 'Event', 'Premium', 'Refined', 'Standard'];

const hitsClass = (h: number | null) =>
  h == null ? 'text-muted-foreground' : h <= 2 ? 'text-emerald-500' : h === 3 ? 'text-lime-500' : h === 4 ? 'text-amber-500' : 'text-red-500';
const ago = (iso: string | null) => {
  if (!iso) return 'never';
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  return h < 1 ? 'just now' : h < 48 ? `${Math.floor(h)}h ago` : `${Math.floor(h / 24)}d ago`;
};

const CITADEL_NOTE = 'Citadel est.: Citadel is the hardest zone, every other zone gives more encounters.';

function Tile({ icon: Icon, label, value, sub }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Icon className="h-3.5 w-3.5" />{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function PetLabel({ species, level, tier, evolution }: { species: string | null; level: number; tier?: string | null; evolution?: number }) {
  if (!species) return <span className="text-muted-foreground">—</span>;
  return (
    <span>
      <span className={TIER_CLASS[tier ?? ''] ?? ''}>{species}</span>
      <span className="text-muted-foreground"> L{level}{evolution ? ` · evo ${evolution}` : ''}</span>
    </span>
  );
}

const HIT_BG: Record<number, string> = {
  1: 'bg-emerald-500 text-white',
  2: 'bg-emerald-500 text-white',
  3: 'bg-lime-500 text-black',
  4: 'bg-amber-500 text-black',
};
const hitBg = (h: number | null) => (h == null ? 'bg-muted text-muted-foreground' : HIT_BG[h] ?? 'bg-red-500 text-white');

/**
 * One square per mob at this location (sorted, coloured by hits). All 2 hits = "perfect";
 * at CL 100+ it also shows how far they can scale and keep every mob at 2 hits.
 */
function HitsStrip({ r, wide }: { r: RosterRow; wide?: boolean }) {
  const b = r.battle;
  if (!b.computed) return <span className="text-xs text-muted-foreground">set gear on /combat</span>;
  const perfect = b.enemies.length > 0 && b.enemies.every((e) => e.hits != null && e.hits <= 2);
  const baseMax = Math.max(0, ...b.enemies.map((e) => e.level));
  const scaled = perfect && b.canScale && b.max2HitLevel != null && b.max2HitLevel > baseMax ? b.max2HitLevel : null;
  const scaledText = scaled ? (b.scaleFixed ? `scaled Lv ${scaled}` : `2 hits to Lv ${scaled}`) : null;
  const sq = wide ? 'h-6 w-6 text-xs' : 'h-5 w-5 text-[11px]';
  return (
    <div className="flex items-center gap-2 whitespace-nowrap">
      <div className="flex gap-0.5">
        {b.enemies.map((e) => (
          <span key={e.id} title={`${e.name} Lv ${e.level}: ${e.hits ?? '—'} hits`} className={`${sq} rounded font-bold tabular-nums flex items-center justify-center ${hitBg(e.hits)}`}>
            {e.hits ?? '–'}
          </span>
        ))}
      </div>
      {perfect ? (
        <span className="text-[11px] text-emerald-500 font-medium flex items-center gap-0.5">
          <Check className="h-3 w-3" />
          {scaledText ?? 'all 2 hits'}
        </span>
      ) : (
        <span className="text-[11px] text-muted-foreground">{b.dist.map((d) => `${d.count}×${d.hits}`).join(' · ')}</span>
      )}
    </div>
  );
}

function PotionIcon({ p, className }: { p: RosterPotion; className?: string }) {
  if (!p.image_url) return <span className={`inline-block rounded-full bg-muted ${className ?? ''}`} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={p.image_url} alt="" className={`rounded-full bg-background object-contain ${className ?? ''}`} />;
}

/** Which /assault/potions preset the loadout is, or Custom. */
function PresetTag({ r }: { r: RosterRow }) {
  const pr = r.battle.preset;
  if (!pr) return <span className="rounded border px-1.5 py-0 text-[10px] text-muted-foreground">Custom</span>;
  return (
    <span
      className={`rounded border px-1.5 py-0 text-[10px] ${pr.recommended ? 'border-crystal/50 text-crystal' : 'border-foreground/20'}`}
      title={pr.recommended ? 'Recommended preset' : 'Preset from /assault/potions'}
    >
      {pr.label}{pr.recommended ? ' ★' : ''}
    </span>
  );
}

/** Overlapping potion icons + preset tag (same look as the loadout pills on /combat). */
function LoadoutPill({ r }: { r: RosterRow }) {
  const b = r.battle;
  if (!b.loadout) return <span className="text-xs text-muted-foreground">not set</span>;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      {b.loadoutPotions.length > 0 && (
        <span className="flex -space-x-1.5">
          {b.loadoutPotions.map((p) => (
            <span key={p.id} title={`${p.name} · ${SLOT_LABEL[p.slot]} · ${p.effect}`} className="relative hover:z-10 transition-transform hover:scale-125">
              <PotionIcon p={p} className="h-6 w-6 ring-2 ring-background" />
            </span>
          ))}
        </span>
      )}
      <PresetTag r={r} />
    </span>
  );
}

const SLOT_LABEL: Record<RosterPotion['slot'], string> = {
  attack: 'Attack', protection: 'Protection', combo: 'Attack + Prot', battle_xp: 'Battle XP', combat_xp: 'Combat XP',
};

const PARTICIPATION_LABEL: Record<Participation, string> = { auto: 'Auto', opt_in: 'Opt-in', none: 'Not assaulting' };
const PARTICIPATION_HINT: Record<Participation, string> = {
  auto: 'Always in: counted for every assault',
  opt_in: 'Chooses per assault',
  none: 'In the guild for boosts or pools only',
};

function RosterTable({ rows, onOpen, compact }: { rows: RosterRow[]; onOpen: (r: RosterRow) => void; compact?: boolean }) {
  return (
    <div className="overflow-x-auto -mx-4 px-4">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground border-b">
            <th className="py-2 pr-3 font-medium">Character</th>
            {!compact && <th className="py-2 pr-3 font-medium" title="Strongest battle pet they own for this location (not the one equipped right now)">Battle pet</th>}
            {!compact && <th className="py-2 pr-3 font-medium" title="Hits per mob at this location with gear from /combat, default potion loadout and the best battle pet. Scaling shown at CL 100+.">Hits</th>}
            {!compact && <th className="py-2 pr-3 font-medium">Loadout</th>}
            <th className="py-2 pr-3 font-medium" title="Hunting Mastery">HM</th>
            <th className="py-2 pr-3 font-medium">Hunting bow</th>
            <th className="py-2 font-medium" title={`Best 20 pets (two squads rotate: hunt, then sleep). ${CITADEL_NOTE}`}>Pet hunt power</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.member_id} className="border-b last:border-0 hover:bg-muted/40 cursor-pointer" onClick={() => onOpen(r)}>
              <td className="py-2 pr-3 whitespace-nowrap">
                <div className="flex items-center gap-2">
                  {r.image_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.image_url} alt="" className="h-7 w-7 rounded object-cover" />
                  )}
                  <div>
                    <div className="font-medium flex items-center gap-1">
                      {r.ign}
                      {r.pets_hidden && <span title="Pets hidden in game settings: showing the last known list"><EyeOff className="h-3.5 w-3.5 text-amber-500" /></span>}
                      {r.last_error && <span title={`Last sync failed: ${r.last_error}`}><AlertTriangle className="h-3.5 w-3.5 text-red-500" /></span>}
                    </div>
                    <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                      CL {r.combat_level ?? '?'} · {r.character_class ?? '?'}
                      {r.participation === 'opt_in' && (
                        <span className="rounded border border-crystal/40 px-1 text-[10px] text-crystal" title={PARTICIPATION_HINT.opt_in}>opt-in</span>
                      )}
                    </div>
                  </div>
                </div>
              </td>
              {!compact && (
                <td className="py-2 pr-3 whitespace-nowrap text-xs">
                  {r.battle.bestPet ? <PetLabel species={r.battle.bestPet.species} level={r.battle.bestPet.level} tier={r.battle.bestPet.tier} /> : <span className="text-muted-foreground">—</span>}
                </td>
              )}
              {!compact && <td className="py-2 pr-3"><HitsStrip r={r} /></td>}
              {!compact && (
                <td className="py-2 pr-3"><LoadoutPill r={r} /></td>
              )}
              <td className="py-2 pr-3 tabular-nums">{r.hunting_mastery ?? '—'}</td>
              <td className="py-2 pr-3 whitespace-nowrap">
                {r.hunting.bow ? (
                  <span className="text-xs"><span className={TIER_CLASS[r.hunting.bow.quality]}>{r.hunting.bow.name}</span> +{r.hunting.bow.huntEff}%</span>
                ) : (
                  <span className="text-xs text-muted-foreground">not set</span>
                )}
              </td>
              <td className="py-2 whitespace-nowrap">
                <span className="font-semibold tabular-nums">{r.hunting.squadPower.toLocaleString()}</span>
                <span className="text-xs text-muted-foreground" title={`Pets L${r.hunting.minPetLevel}+ can hunt here`}> · {Math.min(r.hunting.stableSize, r.hunting.eligibleCount)}/{r.hunting.stableSize} pets</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border bg-muted/30 px-2 py-1.5 text-center">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function Drawer({
  r, zoneName, isOwner, isStaff, goals, onClose, onChanged,
}: { r: RosterRow; zoneName: string | null; isOwner: boolean; isStaff: boolean; goals: GoalSet | null; onClose: () => void; onChanged: () => void }) {
  const canEditBow = isOwner || isStaff;
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const b = r.battle;

  const patch = async (body: Record<string, unknown>, what: string) => {
    setBusy(what);
    setMsg(null);
    const res = await fetch('/api/assault/roster', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ member_id: r.member_id, ...body }) });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setMsg(data.error ?? 'Failed');
    onChanged();
  };
  const refresh = async () => {
    setBusy('refresh');
    setMsg(null);
    const res = await fetch('/api/assault/roster/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ member_id: r.member_id }) });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setMsg(data.error ?? 'Failed');
    if (data.failed?.length) return setMsg(data.failed[0].error);
    onChanged();
  };

  const bows = HUNTING_BOWS.map((bw) => ({ ...bw, blocker: bowBlocker(bw, r.combat_level ?? 0, r.dexterity ?? 0) }));
  const swapPet = b.bestPet && !b.bestPet.equipped && r.equipped_pet?.species;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex justify-end" onClick={onClose}>
      <div className="h-full w-full max-w-xl bg-background border-l overflow-y-auto p-4 space-y-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3">
            {r.image_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={r.image_url} alt="" className="h-10 w-10 rounded object-cover" />
            )}
            <div>
              <div className="text-lg font-semibold">{r.ign}</div>
              <div className="text-xs text-muted-foreground">
                CL {r.combat_level ?? '?'} · {r.character_class ?? '?'} · HM {r.hunting_mastery ?? '?'} · Pet mastery {r.pet_mastery ?? '?'} · synced {ago(r.last_sync)}
              </div>
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>

        <div className="flex gap-3 flex-wrap text-xs">
          <Link className="underline" href={`/p/${encodeURIComponent(r.ign)}`}>Profile</Link>
          <Link className="underline" href="/combat">Open /combat</Link>
          {(canEditBow || isStaff) && (
            <button className="underline disabled:opacity-50" disabled={!!busy} onClick={refresh}>
              {busy === 'refresh' ? 'Refreshing…' : 'Refresh from game'}
            </button>
          )}
        </div>
        {msg && <p className="text-sm text-red-500">{msg}</p>}
        {r.pets_hidden && (
          <p className="text-xs text-amber-500">
            Pets are hidden in game settings, so this shows the last known list. Unhide them, or add your own API key in /setup.
          </p>
        )}

        {goals && <GoalsSection r={r} goals={goals} />}

        {/* ── Battle ── */}
        <section className="rounded-lg border p-3 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold flex items-center gap-1.5"><Swords className="h-4 w-4" />Battle</h3>
            {zoneName && <span className="text-xs text-muted-foreground flex items-center gap-1"><MapPin className="h-3 w-3" />{zoneName}</span>}
          </div>

          <div className="flex items-center justify-between gap-2 rounded-md bg-muted/30 px-3 py-2">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Best battle pet</div>
              <div className="text-sm font-medium">
                {b.bestPet ? <PetLabel species={b.bestPet.species} level={b.bestPet.level} tier={b.bestPet.tier} evolution={b.bestPet.evolution} /> : 'No known pets'}
              </div>
              {swapPet && (
                <div className="text-[11px] text-muted-foreground">Equipped now: {r.equipped_pet!.species} L{r.equipped_pet!.level}, swap before the assault</div>
              )}
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Gear on /combat</div>
              <div className={`text-sm ${b.gearSet ? '' : 'text-amber-500'}`}>{b.gearSet ? 'Set' : 'Not set yet'}</div>
            </div>
          </div>

          {b.stats ? (
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
              <Stat label="AP" value={b.stats.attackPower} />
              <Stat label="Prot" value={b.stats.protection} />
              <Stat label="Agi" value={b.stats.agility} />
              <Stat label="Acc" value={b.stats.accuracy} />
              <Stat label="Crit" value={`${b.stats.critChance}%`} />
              <Stat label="Crit dmg" value={`${b.stats.critDamage}%`} />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Set your gear once on /combat to see stats and hits here.</p>
          )}

          <div className="space-y-1.5">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
              <FlaskConical className="h-3 w-3" />Potions{b.loadout ? <span className="normal-case tracking-normal ml-1"><PresetTag r={r} /></span> : null}
            </div>
            {b.loadoutPotions.length ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {b.loadoutPotions.map((p) => (
                  <div key={p.id} className="flex items-center gap-2 rounded-md border px-2 py-1">
                    <PotionIcon p={p} className="h-7 w-7" />
                    <div className="min-w-0">
                      <div className="text-xs font-medium truncate">{p.name}</div>
                      <div className="text-[10px] text-muted-foreground">{SLOT_LABEL[p.slot]} · {p.effect}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-amber-500">No default potion loadout yet: pick one on /assault/potions.</p>
            )}
          </div>

          {b.computed && (
            <div className="space-y-2">
              <HitsStrip r={r} wide />
              {!b.canScale && <p className="text-[11px] text-muted-foreground">Enemy scaling opens at CL 80.</p>}
              {b.canScale && b.scaleFixed && (
                <p className="text-[11px] text-muted-foreground">Below CL 100, scaling puts every mob at your own CL (Lv {b.scaleMax}). At CL 100 you pick any level up to 150.</p>
              )}
              {b.canScale && !b.scaleFixed && b.max2HitLevel == null && (
                <p className="text-[11px] text-muted-foreground">Once every mob here is 2 hits, this shows how far you can scale (up to Lv 150).</p>
              )}
              <table className="w-full text-xs">
                <tbody>
                  {b.enemies.map((e) => (
                    <tr key={e.id} className="border-b last:border-0">
                      <td className="py-1 pr-2">{e.name}</td>
                      <td className="py-1 pr-2 text-muted-foreground tabular-nums">Lv {e.level}</td>
                      <td className={`py-1 text-right font-semibold tabular-nums ${hitsClass(e.hits)}`}>{e.hits ?? '—'} hits</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ── Hunting bow ── */}
        <section className="rounded-lg border p-3 space-y-2">
          <h3 className="text-sm font-semibold flex items-center gap-1.5"><Target className="h-4 w-4" />Hunting bow</h3>
          {canEditBow ? (
            <select
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={r.hunting.bow?.name ?? ''}
              disabled={!!busy}
              onChange={(e) => patch({ hunting_bow: e.target.value || null }, 'bow')}
            >
              <option value="">No hunting bow</option>
              {bows.map((bw) => (
                <option key={bw.name} value={bw.name}>
                  {bw.name} · +{bw.huntEff}% · CL {bw.combatLevel} / DEX {bw.dexterity}{bw.blocker ? ` (${bw.blocker})` : ''}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-sm">{r.hunting.bow ? `${r.hunting.bow.name} · +${r.hunting.bow.huntEff}% hunt efficiency` : 'Not set'}</p>
          )}
        </section>

        {/* ── Pets ── */}
        <section className="rounded-lg border p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold flex items-center gap-1.5"><PawPrint className="h-4 w-4" />Pet stable</h3>
            <span className="text-xs text-muted-foreground">Pet hunt power <b className="text-foreground">{r.hunting.squadPower.toLocaleString()}</b></span>
          </div>
          <p className="text-xs text-muted-foreground">
            {r.hunting.squadSize} pets hunt at once (pet mastery {r.pet_mastery ?? '?'}). A squad hunts, then sleeps, so the best {r.hunting.stableSize} are counted (highlighted).
            Only pets L{r.hunting.minPetLevel}+ can hunt at {zoneName ?? 'this location'} ({r.hunting.eligibleCount} of {r.pets.length}).
            Encounters per hunt are a {CITADEL_NOTE}
          </p>
          {r.hunting.unknownPets.length > 0 && (
            <p className="text-xs text-amber-500">Unknown pets (not counted): {r.hunting.unknownPets.join(', ')}. Super admin can add them in Admin → System → Pets.</p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground border-b">
                  <th className="py-1.5 pr-2 font-medium">Pet</th>
                  <th className="py-1.5 pr-2 font-medium">Agility</th>
                  <th className="py-1.5 pr-2 font-medium">MS</th>
                  <th className="py-1.5 pr-2 font-medium">Stamina</th>
                  <th className="py-1.5 font-medium">≈ Encounters</th>
                </tr>
              </thead>
              <tbody>
                {r.pets.map((p, i) => (
                  <tr key={`${p.name}-${i}`} className={`border-b last:border-0 ${p.inSquad ? 'bg-crystal/10' : p.eligible ? 'opacity-70' : 'opacity-40'}`}>
                    <td className="py-1.5 pr-2 whitespace-nowrap">
                      <PetLabel species={p.species} level={p.level} tier={p.tier} evolution={p.evolution} />
                      {p.name !== p.species && <span className="text-muted-foreground"> “{p.name}”</span>}
                      {p.equipped && <Badge variant="outline" className="ml-1 text-[10px] py-0">equipped</Badge>}
                      {!p.eligible && <span className="ml-1 text-[10px] text-amber-500">below L{r.hunting.minPetLevel}</span>}
                    </td>
                    <td className="py-1.5 pr-2 tabular-nums">{p.agility}</td>
                    <td className="py-1.5 pr-2 tabular-nums">{p.moveSpeed}</td>
                    <td className="py-1.5 pr-2 tabular-nums">{p.maxStamina}</td>
                    <td className="py-1.5 tabular-nums font-medium">{p.citadelEncounters}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-lg border p-3 space-y-2">
          <h3 className="text-sm font-semibold">Assault participation</h3>
          {(() => {
            const options: Participation[] = isStaff ? ['auto', 'opt_in', 'none'] : ['auto', 'opt_in'];
            const locked = !isStaff && (!isOwner || r.participation === 'none');
            return locked ? (
              <p className="text-sm">
                {PARTICIPATION_LABEL[r.participation]} <span className="text-xs text-muted-foreground">· {PARTICIPATION_HINT[r.participation]}</span>
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {options.map((o) => (
                  <button
                    key={o}
                    type="button"
                    disabled={!!busy}
                    onClick={() => o !== r.participation && patch({ participation: o }, 'participation')}
                    title={PARTICIPATION_HINT[o]}
                    className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                      r.participation === o ? 'border-primary bg-primary/10 text-foreground' : 'hover:bg-muted text-muted-foreground'
                    }`}
                  >
                    {PARTICIPATION_LABEL[o]}
                  </button>
                ))}
              </div>
            );
          })()}
          <p className="text-[11px] text-muted-foreground">
            Auto = always in. Opt-in = you choose per assault. {isStaff ? 'Only staff can mark someone as not assaulting.' : ''}
          </p>
        </section>
      </div>
    </div>
  );
}

export default function AssaultRosterPage() {
  const [guildId, setGuildId] = useState<string | null>(null);
  const [zoneId, setZoneId] = useState<number | null>(null);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [showOthers, setShowOthers] = useState(false);
  const [filter, setFilter] = useState<'all' | 'auto' | 'opt_in'>('all');
  const [view, setView] = useState<'lineup' | 'goals'>('lineup');
  const [refreshing, setRefreshing] = useState<string | null>(null);

  const load = useCallback(async (gid: string | null, zid: number | null) => {
    setLoading(true);
    const q = new URLSearchParams();
    if (gid) q.set('guild', gid);
    if (zid) q.set('zone', String(zid));
    const res = await fetch(`/api/assault/roster?${q}`, { cache: 'no-store' });
    const json = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) return setError(json.error ?? 'Failed to load');
    setError(null);
    setData(json);
  }, []);
  useEffect(() => { load(guildId, zoneId); }, [guildId, zoneId, load]);

  const rows = useMemo(() => data?.roster.rows ?? [], [data]);
  const active = rows.filter((r) => r.participation !== 'none');
  const others = rows.filter((r) => r.participation === 'none');
  const shown = active.filter((r) => filter === 'all' || r.participation === filter);
  const potionUse = useMemo(() => {
    const m = new Map<number, { p: RosterPotion; n: number }>();
    for (const r of rows) if (r.participation !== 'none') for (const p of r.battle.loadoutPotions) m.set(p.id, { p, n: (m.get(p.id)?.n ?? 0) + 1 });
    return Array.from(m.values()).sort((a, b) => b.n - a.n);
  }, [rows]);
  const current = rows.find((r) => r.member_id === open) ?? null;

  const refreshGuild = async () => {
    if (!data) return;
    setRefreshing('Refreshing… (a few seconds per character)');
    let remaining = 1;
    for (let i = 0; i < 4 && remaining > 0; i++) {
      const res = await fetch('/api/assault/roster/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ guild_id: data.guild.id }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setRefreshing(json.error ?? 'Refresh failed'); return; }
      remaining = json.remaining ?? 0;
    }
    setRefreshing(null);
    load(data.guild.id, zoneId);
  };

  if (error) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-10">
        <Card><CardContent className="py-8 text-center text-muted-foreground">{error}</CardContent></Card>
      </div>
    );
  }
  if (!data) {
    return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  const n = active.length || 1;
  const myAttention = active.filter((r) => data.mine.includes(r.member_id) && !meetsMinimum(r, evaluateGoals(r, data.goals)));
  const computed = active.filter((r) => r.battle.computed);
  const lastSync = rows.map((r) => r.last_sync).filter(Boolean).sort().at(-1) ?? null;
  const { roster } = data;

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Users className="h-6 w-6" />Assault roster</h1>
          <p className="text-sm text-muted-foreground">What everyone runs for battle and hunting · synced {ago(lastSync)}</p>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          {data.guilds.length > 1 &&
            data.guilds.map((g) => (
              <Button key={g.id} size="sm" variant={g.id === data.guild.id ? 'default' : 'outline'} onClick={() => { setZoneId(null); setGuildId(g.id); }}>
                {g.nickname ?? g.name}
              </Button>
            ))}
          {data.guild.isStaff && (
            <Button size="sm" variant="outline" disabled={!!refreshing} onClick={refreshGuild}>
              <RefreshCw className={`h-4 w-4 mr-1 ${refreshing ? 'animate-spin' : ''}`} />Refresh guild
            </Button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex rounded-md border p-0.5 mr-1">
          {(['lineup', 'goals'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => {
                setView(v);
                // Goals are always measured at the guild's assault zone.
                if (v === 'goals' && !roster.zone.isTracked) setZoneId(null);
              }}
              className={`rounded px-3 py-1 text-xs font-medium ${view === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {v === 'lineup' ? 'Lineup' : 'Goals'}
            </button>
          ))}
        </div>
        <MapPin className="h-4 w-4 text-muted-foreground" />
        <select
          className="h-9 rounded-md border bg-background px-2 text-sm max-w-full disabled:opacity-60"
          value={roster.zone.id ?? ''}
          disabled={view === 'goals'}
          title={view === 'goals' ? "Goals are measured at the guild's assault zone" : undefined}
          onChange={(e) => setZoneId(Number(e.target.value) || null)}
        >
          {roster.zones.map((z) => (
            <option key={z.id} value={z.id}>
              {z.name} · Lv {z.minLevel === z.maxLevel ? z.minLevel : `${z.minLevel}–${z.maxLevel}`}{z.id === roster.trackedZoneId ? ' · guild assault zone' : ''}
            </option>
          ))}
        </select>
        {!roster.zone.isTracked && roster.trackedZoneId && (
          <button className="text-xs underline text-muted-foreground" onClick={() => setZoneId(roster.trackedZoneId)}>back to the guild&apos;s zone</button>
        )}
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>
      {refreshing && <p className="text-sm text-muted-foreground">{refreshing}</p>}

      {/* Your own characters that still need setup or are below the minimum: impossible to miss. */}
      {roster.zone.isTracked &&
        myAttention.map((r) => (
          <div key={r.member_id} className="cursor-pointer" onClick={() => setOpen(r.member_id)}>
            <SetupEligibility r={r} goals={data.goals} showName />
          </div>
        ))}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Tile
          icon={Users}
          label="Assaulters"
          value={String(active.length)}
          sub={`${active.filter((r) => r.participation === 'auto').length} auto · ${active.filter((r) => r.participation === 'opt_in').length} opt-in${others.length ? ` · ${others.length} not assaulting` : ''}`}
        />
        <Tile
          icon={PawPrint}
          label="Avg pet hunt power"
          value={Math.round(active.reduce((s, r) => s + r.hunting.squadPower, 0) / n).toLocaleString()}
          sub={`best 20 pets L${active[0]?.hunting.minPetLevel ?? 1}+ · Citadel est.`}
        />
        <Tile
          icon={Swords}
          label="All mobs ≤3 hits here"
          value={`${computed.filter((r) => (r.battle.worstHits ?? 99) <= 3).length}/${computed.length}`}
          sub={`${active.length - computed.length} without gear on /combat`}
        />
        <Tile
          icon={Target}
          label="Setups filled in"
          value={`${active.filter((r) => r.battle.loadout).length} loadouts · ${active.filter((r) => r.hunting.bow).length} bows`}
          sub={`of ${active.length}`}
        />
      </div>

      {view === 'goals' ? (
        roster.zone.isTracked || !roster.trackedZoneId ? (
          <GoalsView rows={active} goals={data.goals} onOpen={(r) => setOpen(r.member_id)} />
        ) : (
          <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin" /></div>
        )
      ) : (
      <>
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-base">{data.guild.name}</CardTitle>
            <div className="flex gap-1">
              {(['all', 'auto', 'opt_in'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={`rounded-md border px-2 py-0.5 text-xs ${filter === f ? 'border-primary bg-primary/10' : 'text-muted-foreground hover:bg-muted'}`}
                >
                  {f === 'all' ? 'All' : PARTICIPATION_LABEL[f]}
                </button>
              ))}
            </div>
          </div>
          <CardDescription>
            Click a row for details. Battle pet = the strongest one they own for this location. Hits use gear from /combat, the default potion loadout and that pet, patted.
            Pet hunt power counts the best 20 pets ({CITADEL_NOTE})
          </CardDescription>
        </CardHeader>
        <CardContent>
          {shown.length ? <RosterTable rows={shown} onOpen={(r) => setOpen(r.member_id)} /> : <p className="text-sm text-muted-foreground">Nobody here yet.</p>}
        </CardContent>
      </Card>

      {potionUse.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-1.5"><FlaskConical className="h-4 w-4" />Potions in use</CardTitle>
            <CardDescription>From everyone&apos;s default assault loadout ({active.filter((r) => r.battle.loadout).length} of {active.length} have one).</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-1.5">
            {potionUse.map(({ p, n: count }) => (
              <span key={p.id} className="inline-flex items-center gap-1.5 rounded-md border pl-1 pr-2 py-0.5 text-xs" title={`${p.name} · ${SLOT_LABEL[p.slot]} · ${p.effect}`}>
                <PotionIcon p={p} className="h-5 w-5" />
                {p.name}
                <b className="tabular-nums">{count}</b>
              </span>
            ))}
          </CardContent>
        </Card>
      )}

      </>
      )}

      {others.length > 0 && (
        <Card>
          <CardHeader className="pb-2 cursor-pointer" onClick={() => setShowOthers((v) => !v)}>
            <CardTitle className="text-base flex items-center gap-1">
              {showOthers ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              Not assaulting ({others.length})
            </CardTitle>
            <CardDescription>In the guild for boosts or pools. Not counted in the numbers above.</CardDescription>
          </CardHeader>
          {showOthers && (
            <CardContent>
              <RosterTable rows={others} compact onOpen={(r) => setOpen(r.member_id)} />
            </CardContent>
          )}
        </Card>
      )}

      <div className="flex gap-3 flex-wrap text-xs">
        {TIER_ORDER.map((q) => <span key={q} className={TIER_CLASS[q]}>{q}</span>)}
      </div>

      {current && (
        <Drawer
          r={current}
          zoneName={roster.zone.name}
          isOwner={data.mine.includes(current.member_id)}
          isStaff={data.guild.isStaff}
          goals={roster.zone.isTracked ? data.goals : null}
          onClose={() => setOpen(null)}
          onChanged={() => load(data.guild.id, zoneId)}
        />
      )}
    </div>
  );
}
