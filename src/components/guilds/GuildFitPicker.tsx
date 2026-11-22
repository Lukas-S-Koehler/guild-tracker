'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Loader2, Search, ArrowRight, Swords, Shield } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { fitGuilds, type FitGuild } from '@/lib/guild-fit';
import { requirementLabel } from '@/components/guilds/GuildCard';

const guildHref = (g: FitGuild) => `/guilds/${g.tag.toLowerCase()}`;
/** "CL 1 / 12 / 25 raids": the raids a guild runs, by CL (the community name for them). */
const raidsText = (g: FitGuild, tierCl: number) =>
  `CL ${(g.raids.length ? g.raids.map((r) => r.min_cl) : [tierCl]).join(' / ')} raids`;

function GuildLink({ g }: { g: FitGuild }) {
  return <Link href={guildHref(g)} className="font-medium text-foreground hover:underline">{g.name}</Link>;
}

/** CL in, your guild out. Raid tier by CL (fallback one tier down when full), plus the assault options. */
export default function GuildFitPicker({ guilds }: { guilds: FitGuild[] }) {
  const { user, myCharacters } = useAuth();
  const [clText, setClText] = useState('');
  const [ign, setIgn] = useState('');
  const [showLookup, setShowLookup] = useState(false);
  const [lookup, setLookup] = useState<{ loading: boolean; msg: string | null }>({ loading: false, msg: null });

  const cl = parseInt(clText, 10);
  const answer = useMemo(() => (Number.isFinite(cl) && cl > 0 ? fitGuilds(guilds, Math.min(cl, 150)) : null), [guilds, cl]);

  async function lookUp(name: string) {
    const n = name.trim();
    if (!n) return;
    setIgn(n);
    setLookup({ loading: true, msg: null });
    try {
      const res = await fetch(`/api/guilds/fit-lookup?ign=${encodeURIComponent(n)}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Lookup failed');
      if (!d.found) setLookup({ loading: false, msg: `We don't track "${n}" yet. Type your CL instead.` });
      else if (d.combat_level == null) setLookup({ loading: false, msg: `Found ${d.ign}, but no CL yet. Type it instead.` });
      else {
        setClText(String(d.combat_level));
        setLookup({ loading: false, msg: `${d.ign}: CL ${d.combat_level}${d.guild ? `, currently in ${d.guild.name}` : ''}` });
      }
    } catch (e) {
      setLookup({ loading: false, msg: e instanceof Error ? e.message : 'Lookup failed' });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="fit-cl" className="text-sm font-medium">Your combat level</label>
        <Input
          id="fit-cl"
          inputMode="numeric"
          value={clText}
          onChange={(e) => setClText(e.target.value.replace(/[^\d]/g, '').slice(0, 3))}
          placeholder="e.g. 64"
          className="w-28 text-lg font-semibold"
        />
        {!showLookup && (
          <button type="button" onClick={() => setShowLookup(true)} className="text-xs text-muted-foreground hover:text-foreground underline-offset-4 hover:underline">
            or look it up by name
          </button>
        )}
      </div>

      {showLookup && (
        <div className="space-y-1.5">
          <form className="flex max-w-sm gap-2" onSubmit={(e) => { e.preventDefault(); lookUp(ign); }}>
            <Input value={ign} onChange={(e) => setIgn(e.target.value)} placeholder="Character name" maxLength={40} />
            <Button type="submit" variant="outline" size="icon" disabled={lookup.loading || !ign.trim()} aria-label="Look up combat level">
              {lookup.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            </Button>
          </form>
          {user && myCharacters.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {myCharacters.map((c) => (
                <button key={c.member_id} type="button" onClick={() => lookUp(c.ign)} className="text-xs rounded border px-2 py-0.5 hover:bg-accent">{c.ign}</button>
              ))}
            </div>
          )}
          {lookup.msg && <p className="text-xs text-muted-foreground">{lookup.msg}</p>}
        </div>
      )}

      {!answer ? (
        <p className="text-sm text-muted-foreground">Combat level (CL), not total level. It&apos;s on your IdleMMO character page.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {/* Raids */}
          <div className="rounded-lg border border-crystal/40 bg-crystal/5 p-4 space-y-2">
            <p className="flex items-center gap-2 text-xs uppercase tracking-wider text-crystal"><Swords className="h-3.5 w-3.5" />Raids</p>
            {answer.tier ? (
              <>
                <p className="text-lg">
                  {answer.tier.guilds.map((g, i) => (
                    <span key={g.id}>{i > 0 && ' or '}<GuildLink g={g} /></span>
                  ))}
                </p>
                <p className="text-sm text-muted-foreground">
                  {raidsText(answer.tier.guilds[0], answer.tier.cl)} · {requirementLabel(answer.tier.guilds[0])}
                </p>
                {answer.fallback && (
                  <p className="text-xs text-muted-foreground">
                    Full? Go one down: {answer.fallback.guilds.map((g, i) => <span key={g.id}>{i > 0 && ' / '}<GuildLink g={g} /></span>)} (CL {answer.fallback.cl} raids).
                  </p>
                )}
                {answer.next && (
                  <p className="text-xs text-muted-foreground">
                    Next: CL {answer.next.cl} raids in {answer.next.guilds.map((g, i) => <span key={g.id}>{i > 0 && ' / '}<GuildLink g={g} /></span>)}, {answer.next.levels_needed} CL to go.
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No raid guild is open at this level right now.</p>
            )}
          </div>

          {/* Assaults */}
          {(answer.de || answer.di) && (
            <div className="rounded-lg border p-4 space-y-2">
              <p className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground"><Shield className="h-3.5 w-3.5" />Or no raids: pools &amp; assaults</p>
              {answer.de && (
                <p className="text-sm"><GuildLink g={answer.de} />: Energizing Pools guild (MF and EXP boost), open to every level. Casual assaults too.</p>
              )}
              {answer.di && (
                <p className="text-sm">
                  <GuildLink g={answer.di} />:{' '}
                  {answer.di_open ? 'hardcore assaults, you qualify (CL 88+).' : <span className="text-muted-foreground">hardcore assaults at CL 88+, {answer.di_levels_needed} to go.</span>}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {answer?.tier && (
        <p className="text-sm">
          <Link href={guildHref(answer.tier.guilds[0])} className="inline-flex items-center gap-1 text-crystal hover:underline">
            See {answer.tier.guilds[0].name} <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </p>
      )}
    </div>
  );
}
