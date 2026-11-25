'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle2, ChevronDown, ChevronRight, Loader2, MapPin, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import type { EligibilityCharacter, GuildRubric } from '@/lib/assault-eligibility';
import type { GearSelection } from '@/lib/combat/character-stats';
import { TIERS, TIER_MEANING } from '@/lib/roster-goals';
import { HUNTING_BOWS, bowBlocker } from '@/lib/combat/hunting-gear';
import { GoalsSection, MinimumChecklist } from '@/components/assault/RosterGoals';
import { GearSection } from '@/components/assault/RosterGear';
import { useAuth } from '@/contexts/AuthContext';
import { ClaimPrompt } from '@/components/access/ClaimPrompt';
import { useAccess } from '@/lib/use-access';

interface Payload {
  rubrics: GuildRubric[];
  characters: EligibilityCharacter[];
  sync: { synced: number; failed: { ign: string; error: string }[]; remaining: number };
  interest: Record<string, { guild_id: string | null; at: string; status: string }>;
}

const CITADEL_NOTE = 'Pet hunt power is a Citadel estimate: Citadel is the hardest zone, every other zone gives more encounters.';
const ago = (iso: string | null) => {
  if (!iso) return 'never';
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  return h < 1 ? 'just now' : h < 48 ? `${Math.floor(h)}h ago` : `${Math.floor(h / 24)}d ago`;
};
const guildLabel = (g: GuildRubric) => g.nickname ?? g.name;

async function post(body: Record<string, unknown>): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch('/api/assault/eligibility', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { ok: res.ok, data: await res.json().catch(() => ({})) };
}

function BowSelect({ r, setBow }: { r: EligibilityCharacter['results'][number]['row']; setBow: (name: string | null) => Promise<string | null> }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="space-y-1">
      <select
        className="h-9 w-full rounded-md border bg-background px-2 text-sm"
        value={r.hunting.bow?.name ?? ''}
        disabled={busy}
        onChange={async (e) => {
          setBusy(true);
          setMsg(null);
          setMsg(await setBow(e.target.value || null));
          setBusy(false);
        }}
      >
        <option value="">No hunting bow</option>
        {HUNTING_BOWS.map((bw) => {
          const blocker = bowBlocker(bw, r.combat_level ?? 0, r.dexterity ?? 0);
          return (
            <option key={bw.name} value={bw.name}>
              {bw.name} · +{bw.huntEff}% · CL {bw.combatLevel} / DEX {bw.dexterity}{blocker ? ` (${blocker})` : ''}
            </option>
          );
        })}
      </select>
      {msg && <p className="text-xs text-red-500">{msg}</p>}
    </div>
  );
}

/** What the checklist can do: save gear/bow, and (signed in) say you're interested. */
interface ChecklistActions {
  saveGear: (gear: GearSelection[]) => Promise<string | null>;
  setBow: (name: string | null) => Promise<string | null>;
  /** Signed in only; the public lookup shows a sign-up prompt instead. */
  interest?: () => Promise<string | null>;
  /** Shown instead of the interest button (public lookup). */
  joinPrompt?: React.ReactNode;
}

/** One character against one guild: the checklist, then "interested" once the minimum is reached. */
function CharacterChecklist({
  c, guild, interest, onChanged, actions,
}: {
  c: EligibilityCharacter;
  guild: GuildRubric;
  interest?: Payload['interest'][string];
  onChanged: () => void;
  actions: ChecklistActions;
}) {
  const res = c.results.find((x) => x.guild.id === guild.id);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  if (!res) return <p className="text-sm text-muted-foreground">Not read from the game yet. Try Refresh in a moment.</p>;
  const { row: r, verdict } = res;
  const asked = interest?.guild_id === guild.id && interest.status === 'interested';

  return (
    <div className="space-y-4">
      <MinimumChecklist
        key={`${c.hashed_id}:${guild.id}`}
        r={r}
        goals={guild.goals}
        slots={{
          gear: <GearSection r={r} canEdit onSaved={onChanged} onSave={actions.saveGear} startOpen />,
          bow: <BowSelect r={r} setBow={actions.setBow} />,
        }}
      />

      <div className={`rounded-lg border p-4 ${verdict.meets ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-dashed'}`}>
        {actions.joinPrompt ? (
          actions.joinPrompt
        ) : verdict.meets ? (
          asked ? (
            <p className="text-sm text-emerald-500 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" />Interest sent {new Date(interest!.at).toLocaleDateString()}. Staff will reach out in game.
            </p>
          ) : (
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-sm">
                <b>{c.ign}</b> meets the {guildLabel(guild)} minimum. Want to join?
              </p>
              <Button
                disabled={busy}
                onClick={async () => {
                  if (!actions.interest) return;
                  setBusy(true);
                  setMsg(null);
                  setMsg(await actions.interest());
                  setBusy(false);
                }}
              >
                {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1" />}
                I&apos;m interested in joining {guildLabel(guild)}
              </Button>
            </div>
          )
        ) : (
          <p className="text-sm text-muted-foreground">Tick everything above and you can tell staff you&apos;re interested in joining {guildLabel(guild)}.</p>
        )}
        {msg && <p className="text-xs text-red-500 mt-2">{msg}</p>}
      </div>

      <div>
        <button type="button" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" onClick={() => setMore(!more)}>
          {more ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}Beyond the minimum: tiers and next moves
        </button>
        {more && (
          <div className="mt-2 space-y-2">
            <p className="text-xs text-muted-foreground">
              After Bronze come {TIERS.slice(1).map((t, i) => <span key={t}>{i ? ', ' : ''}<b>{t}</b> ({TIER_MEANING[t].toLowerCase()})</span>)}. {CITADEL_NOTE}
            </p>
            <GoalsSection r={r} goals={guild.goals} eligibility />
          </div>
        )}
      </div>
    </div>
  );
}

export default function AssaultEligibilityPage() {
  const { user, loading } = useAuth();
  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }
  return user ? <OwnEligibility /> : <PublicEligibility />;
}

/** Signed out: look a character up by its id. Gear and bow stay in the browser. */
function PublicEligibility() {
  const [input, setInput] = useState('');
  const [hashed, setHashed] = useState<string | null>(null);
  const [gear, setGear] = useState<GearSelection[] | null>(null);
  const [bow, setBow] = useState<string | null>(null);
  const [result, setResult] = useState<{ character: EligibilityCharacter; rubrics: GuildRubric[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async (id: string, g: GearSelection[] | null, b: string | null): Promise<string | null> => {
    setBusy(true);
    const res = await fetch('/api/assault/eligibility/public', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hashed_id: id, gear: g, bow: b }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return String(json.error ?? 'Lookup failed');
    setResult(json);
    return null;
  }, []);

  // ?id=… in the link, else the last id this browser checked.
  useEffect(() => {
    let id = new URLSearchParams(window.location.search).get('id');
    if (!id) {
      try { id = localStorage.getItem('eligibility:id'); } catch { /* storage blocked */ }
    }
    if (id) {
      setInput(id);
      setHashed(id);
      check(id, null, null).then(setError);
    }
  }, [check]);

  const submit = async () => {
    const raw = input.trim();
    const id = raw.replace(/^#/, '');
    setGear(null);
    setBow(null);
    setResult(null);
    const err = await check(id, null, null);
    setError(err);
    if (!err) {
      setHashed(id);
      try { localStorage.setItem('eligibility:id', id); } catch { /* storage blocked */ }
      window.history.replaceState(null, '', `?id=${id}`);
    }
  };

  const c = result?.character;
  const guild = result?.rubrics[0];
  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><ShieldCheck className="h-6 w-6" />Assault minimum</h1>
        <p className="text-sm text-muted-foreground">
          Could your character join {guild ? <b className="text-foreground">{guild.name}</b> : 'our assault guild'}? Enter its hashed ID to see the checklist.
        </p>
      </div>
      <ClaimPrompt signedIn={false} />
      <Card>
        <CardContent className="pt-4 space-y-2">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Hashed ID"
              className="h-9 flex-1 min-w-0 rounded-md border bg-background px-3 text-sm"
            />
            <Button type="submit" disabled={busy || !input.trim()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Check'}
            </Button>
          </form>
          <p className="text-xs text-muted-foreground">
            Turn on <b>Show hashed ID</b> in the in-game settings to see it. Gear and bow you pick here aren&apos;t saved.
          </p>
          {error && <p className="text-sm text-red-500">{error}</p>}
        </CardContent>
      </Card>

      {c && guild && hashed && (
        <Card>
          <CardContent className="pt-4 space-y-4">
            <div className="flex items-center gap-3">
              {c.image_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.image_url} alt="" className="h-10 w-10 rounded object-cover" />
              )}
              <div>
                <div className="font-semibold">{c.ign}</div>
                <div className="text-xs text-muted-foreground flex items-center gap-1 flex-wrap">
                  CL {c.combat_level ?? '?'} · {c.character_class ?? '?'} · measured at
                  <span className="inline-flex items-center gap-0.5"><MapPin className="h-3 w-3" />{guild.zoneName ?? 'the assault zone'}</span>
                  · read from the game {ago(c.last_sync)}
                </div>
              </div>
            </div>
            <CharacterChecklist
              key={`${c.hashed_id}:${guild.id}`}
              c={c}
              guild={guild}
              onChanged={() => undefined}
              actions={{
                saveGear: async (g) => {
                  setGear(g);
                  return check(hashed, g, bow);
                },
                setBow: async (b) => {
                  setBow(b);
                  return check(hashed, gear, b);
                },
                joinPrompt: (
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <p className="text-sm">
                      {c.results[0]?.verdict.meets ? <><b>{c.ign}</b> meets the minimum. </> : null}
                      Create an account and claim your character to save your gear and tell staff you&apos;re interested.
                    </p>
                    <div className="flex gap-2">
                      <Button asChild size="sm"><Link href="/signup">Create account</Link></Button>
                      <Button asChild size="sm" variant="ghost"><Link href="/login">Sign in</Link></Button>
                    </div>
                  </div>
                ),
              }}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** Signed in: your claimed characters outside the assault guilds. */
function OwnEligibility() {
  const { outsideDream } = useAccess();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [guildId, setGuildId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    // Stale snapshots refresh inside the request; keep asking while some are left (3 API calls each).
    for (let i = 0; i < 4; i++) {
      const res = await fetch('/api/assault/eligibility', { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoading(false);
        return setError(json.error ?? 'Failed to load');
      }
      setError(null);
      setData(json);
      if (!json.sync?.remaining) break;
      setNote(`Reading your characters from the game… ${json.sync.remaining} left`);
    }
    setNote(null);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  if (error) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-10">
        <Card><CardContent className="py-8 text-center text-muted-foreground">{error}</CardContent></Card>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex flex-col items-center gap-2 py-20 text-sm text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
        {note ?? 'Measuring your characters…'}
      </div>
    );
  }

  const guild = data.rubrics.find((g) => g.id === guildId) ?? data.rubrics[0];
  const c = data.characters.find((x) => x.hashed_id === picked) ?? data.characters[0];
  const meetsHere = (x: EligibilityCharacter) => !!x.results.find((r) => r.guild.id === guild?.id)?.verdict.meets;

  const refresh = async () => {
    if (!c) return;
    setRefreshing(true);
    const { ok, data: d } = await post({ hashed_id: c.hashed_id });
    setRefreshing(false);
    if (!ok) return setNote(String(d.error ?? 'Refresh failed'));
    const failed = (d.failed as { error: string }[] | undefined)?.[0];
    setNote(failed ? `${c.ign}: ${failed.error}` : null);
    load();
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><ShieldCheck className="h-6 w-6" />Assault minimum</h1>
          {guild && (
            <p className="text-sm text-muted-foreground flex items-center gap-1 flex-wrap">
              What a character needs to join <b className="text-foreground">{guild.name}</b>, measured at
              <span className="inline-flex items-center gap-0.5"><MapPin className="h-3.5 w-3.5" />{guild.zoneName ?? 'its assault zone'}</span>.
            </p>
          )}
        </div>
        {loading && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground shrink-0" />}
      </div>
      {note && <p className="text-sm text-muted-foreground">{note}</p>}

      {data.rubrics.length > 1 && (
        <div className="flex gap-1 flex-wrap">
          {data.rubrics.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => setGuildId(g.id)}
              className={`rounded-md border px-3 py-1 text-sm ${g.id === guild?.id ? 'border-primary bg-primary/10' : 'text-muted-foreground hover:bg-muted'}`}
            >
              {g.name}
            </button>
          ))}
        </div>
      )}

      {!c ? (
        <>
        {outsideDream && <ClaimPrompt signedIn />}
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground space-y-2">
            <p>No claimed characters outside the assault guilds.</p>
            <p>
              Characters in an assault guild are on the <Link className="underline" href="/assault/roster">roster</Link>. To check another
              character, claim it on your <Link className="underline" href="/account">account</Link>.
            </p>
          </CardContent>
        </Card>
        </>
      ) : (
        <>
          {outsideDream && <ClaimPrompt signedIn />}
          {data.characters.length > 1 && (
            <div className="flex gap-1.5 flex-wrap">
              {data.characters.map((x) => (
                <button
                  key={x.hashed_id}
                  type="button"
                  onClick={() => setPicked(x.hashed_id)}
                  className={`rounded-md border px-3 py-1.5 text-sm flex items-center gap-1.5 ${x.hashed_id === c.hashed_id ? 'border-primary bg-primary/10' : 'text-muted-foreground hover:bg-muted'}`}
                >
                  {meetsHere(x) && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
                  {x.ign}
                  <span className="text-[11px] text-muted-foreground">CL {x.combat_level ?? '?'}</span>
                </button>
              ))}
            </div>
          )}

          <Card>
            <CardContent className="pt-4 space-y-4">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-3">
                  {c.image_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.image_url} alt="" className="h-10 w-10 rounded object-cover" />
                  )}
                  <div>
                    <div className="font-semibold">{c.ign}</div>
                    <div className="text-xs text-muted-foreground">
                      CL {c.combat_level ?? '?'} · {c.character_class ?? '?'} · {c.guild_name ?? 'not in a Dream guild'} · read from the game {ago(c.last_sync)}
                    </div>
                  </div>
                </div>
                <Button size="sm" variant="outline" disabled={refreshing} onClick={refresh}>
                  <RefreshCw className={`h-3.5 w-3.5 mr-1 ${refreshing ? 'animate-spin' : ''}`} />Refresh
                </Button>
              </div>
              {c.last_error && <p className="text-xs text-red-500">Last read failed: {c.last_error}</p>}
              {guild && (
                <CharacterChecklist
                  key={`${c.hashed_id}:${guild.id}`}
                  c={c}
                  guild={guild}
                  interest={data.interest[c.ign.toLowerCase()]}
                  onChanged={load}
                  actions={{
                    saveGear: async (gear) => {
                      const { ok, data: d } = await post({ action: 'gear', hashed_id: c.hashed_id, gear });
                      return ok ? null : String(d.error ?? 'Save failed');
                    },
                    setBow: async (name) => {
                      const { ok, data: d } = await post({ action: 'bow', hashed_id: c.hashed_id, hunting_bow: name });
                      if (!ok) return String(d.error ?? 'Failed');
                      load();
                      return null;
                    },
                    interest: async () => {
                      const { ok, data: d } = await post({ action: 'interest', hashed_id: c.hashed_id, guild_id: guild.id });
                      if (!ok) return String(d.error ?? 'Failed');
                      load();
                      return null;
                    },
                  }}
                />
              )}
            </CardContent>
          </Card>
        </>
      )}

      <p className="text-xs text-muted-foreground">
        Saying you&apos;re interested adds you to the staff recruiting list and lets them know in Discord. The guild move itself happens in game.
      </p>
    </div>
  );
}
