'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2, Search, Sparkles, AlertTriangle, ArrowUpRight } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { fitGuilds, type FitGuild, type Playstyle } from '@/lib/guild-fit';

const PLAYSTYLES: { key: Playstyle; label: string; hint: string }[] = [
  { key: 'raids', label: 'Raids', hint: 'Scheduled guild raids for marks' },
  { key: 'assaults', label: 'Assaults', hint: 'Conquests, waves, territory' },
  { key: 'any', label: 'Not sure', hint: 'Show me both' },
];

export default function GuildFitPicker({ guilds }: { guilds: FitGuild[] }) {
  const { user, myCharacters } = useAuth();
  const [ign, setIgn] = useState('');
  const [clText, setClText] = useState('');
  const [playstyle, setPlaystyle] = useState<Playstyle>('any');
  const [budgetText, setBudgetText] = useState('');
  const [lookup, setLookup] = useState<{ loading: boolean; msg: string | null }>({ loading: false, msg: null });

  const cl = Math.max(0, Math.min(150, parseInt(clText, 10)));
  const budget = budgetText.trim() === '' ? null : Math.max(0, parseInt(budgetText.replace(/[^\d]/g, ''), 10) || 0);
  const answer = useMemo(() => (Number.isFinite(cl) && cl > 0 ? fitGuilds(guilds, cl, playstyle, budget) : null), [guilds, cl, playstyle, budget]);

  async function lookUp(name: string) {
    const n = name.trim();
    if (!n) return;
    setIgn(n);
    setLookup({ loading: true, msg: null });
    try {
      const res = await fetch(`/api/guilds/fit-lookup?ign=${encodeURIComponent(n)}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Lookup failed');
      if (!d.found) setLookup({ loading: false, msg: `We don't track "${n}" yet. Enter your combat level below.` });
      else if (d.combat_level == null) setLookup({ loading: false, msg: `Found ${d.ign}, but no combat level yet. Enter it below.` });
      else {
        setClText(String(d.combat_level));
        setLookup({ loading: false, msg: `${d.ign}: CL ${d.combat_level}${d.guild ? ` · currently in ${d.guild.name}` : ''}` });
      }
    } catch (e) {
      setLookup({ loading: false, msg: e instanceof Error ? e.message : 'Lookup failed' });
    }
  }

  return (
    <Card className="border-sky-500/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-sky-400" />Which guild fits me?</CardTitle>
        <CardDescription>
          Guild entry and raids go by <strong>combat level</strong> (not total level). Find yours on your IdleMMO character page.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="fit-ign">Character name (optional)</Label>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); lookUp(ign); }}>
              <Input id="fit-ign" value={ign} onChange={(e) => setIgn(e.target.value)} placeholder="Your IGN" maxLength={40} />
              <Button type="submit" variant="outline" size="icon" disabled={lookup.loading || !ign.trim()} aria-label="Look up combat level">
                {lookup.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              </Button>
            </form>
            {user && myCharacters.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                {myCharacters.map((c) => (
                  <button key={c.member_id} type="button" onClick={() => lookUp(c.ign)} className="text-xs rounded border px-2 py-0.5 hover:bg-accent">
                    {c.ign}
                  </button>
                ))}
              </div>
            )}
            {lookup.msg && <p className="text-xs text-muted-foreground">{lookup.msg}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fit-cl">Combat level</Label>
            <Input id="fit-cl" inputMode="numeric" value={clText} onChange={(e) => setClText(e.target.value.replace(/[^\d]/g, '').slice(0, 3))} placeholder="e.g. 64" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fit-budget">Gold you can donate per day (optional)</Label>
            <Input id="fit-budget" inputMode="numeric" value={budgetText} onChange={(e) => setBudgetText(e.target.value.replace(/[^\d]/g, '').slice(0, 9))} placeholder="e.g. 5000" />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>What do you want to play?</Label>
          <div className="grid grid-cols-3 gap-2">
            {PLAYSTYLES.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => setPlaystyle(p.key)}
                aria-pressed={playstyle === p.key}
                className={`rounded-md border p-2 text-left transition-colors ${playstyle === p.key ? 'border-sky-500 bg-sky-500/10' : 'hover:bg-accent/40'}`}
              >
                <span className="block text-sm font-medium">{p.label}</span>
                <span className="hidden sm:block text-xs text-muted-foreground">{p.hint}</span>
              </button>
            ))}
          </div>
        </div>

        {!answer ? (
          <p className="text-sm text-muted-foreground">Enter your combat level to see your matches.</p>
        ) : (
          <div className="space-y-3">
            {answer.best_raid && (
              <p className="text-sm text-muted-foreground">
                At CL {cl} the highest raid you can join is <strong className="text-foreground">{answer.best_raid.name}</strong> ({answer.best_raid.location}, {answer.best_raid.marks} marks).
              </p>
            )}
            {answer.picks.length === 0 ? (
              <p className="text-sm">No guild matches yet. Try &quot;Not sure&quot; or a different budget.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {answer.picks.map((p, i) => (
                  <Link key={p.guild.id} href={`/guilds/${p.guild.tag.toLowerCase()}`} className="block group">
                    <div className={`h-full rounded-lg border p-3 space-y-2 transition-colors group-hover:bg-accent/30 ${i === 0 ? 'border-sky-500/60 bg-sky-500/5' : ''}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold">{p.guild.name}</span>
                        {i === 0 ? <Badge className="bg-sky-500/20 text-sky-300 border-sky-500/50" variant="outline">Best fit</Badge> : <ArrowUpRight className="h-4 w-4 text-muted-foreground" />}
                      </div>
                      <ul className="text-xs text-muted-foreground space-y-1">
                        {p.reasons.map((r) => <li key={r}>• {r}</li>)}
                        {p.warnings.map((w) => (
                          <li key={w} className="flex gap-1 text-amber-400"><AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />{w}</li>
                        ))}
                      </ul>
                    </div>
                  </Link>
                ))}
              </div>
            )}
            {answer.next_goal && playstyle !== 'assaults' && (
              <p className="text-sm text-muted-foreground">
                Next goal: <Link className="underline" href={`/guilds/${answer.next_goal.guild.tag.toLowerCase()}`}>{answer.next_goal.guild.name}</Link> at CL {answer.next_goal.guild.min_level} ({answer.next_goal.levels_needed} to go).
              </p>
            )}
            {answer.assault_note && playstyle !== 'raids' && <p className="text-xs text-muted-foreground">{answer.assault_note}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
