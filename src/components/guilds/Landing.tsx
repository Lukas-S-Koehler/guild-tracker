'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, Swords, Coins, Users, Shield, Trophy, Sparkles, Gem } from 'lucide-react';
import { formatGold } from '@/lib/utils';
import type { GuildDirectory } from '@/lib/guild-directory';
import GuildCard from '@/components/guilds/GuildCard';
import GuildFitPicker from '@/components/guilds/GuildFitPicker';

const FEATURES = [
  { icon: Swords, title: 'Raids for every level', text: 'A ladder of raid guilds from CL 1 to The Silent Watchers, each running the raid that fits its members.' },
  { icon: Shield, title: 'Assault guilds', text: 'Dream Engineers and Dream Invaders fight conquests together for territory boosts and shards.' },
  { icon: Trophy, title: 'Your progress, tracked', text: 'Daily activity, streaks, leaderboards and a personal dashboard across all your characters.' },
  { icon: Users, title: 'One community', text: 'Move up the ladder as you level without leaving the Dream family or its Discord.' },
];

export default function Landing() {
  const [dir, setDir] = useState<GuildDirectory | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch('/api/guilds/directory')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setDir)
      .catch(() => setFailed(true));
  }, []);

  const active = dir?.guilds.filter((g) => g.is_active) ?? [];
  const showcase = [...active].sort((a, b) => Number(b.is_assault) - Number(a.is_assault) || b.min_level - a.min_level);

  return (
    <div className="space-y-12 -mt-2">
      <section className="relative overflow-hidden rounded-2xl border border-sky-500/20 bg-gradient-to-br from-sky-950/60 via-background to-background px-6 py-12 md:px-12 md:py-16">
        <div className="max-w-2xl space-y-5">
          <p className="inline-flex items-center gap-2 text-xs uppercase tracking-widest text-sky-400"><Gem className="h-3.5 w-3.5" />IdleMMO guild network</p>
          <h1 className="text-4xl md:text-5xl font-bold leading-tight">Find your place in the Dream Guilds</h1>
          <p className="text-lg text-muted-foreground">
            {dir ? `${dir.network.active_guilds} guilds and ${dir.network.members} players` : 'A family of guilds'} raiding, conquering and levelling together. Pick the guild that matches your combat level and grow from there.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg" className="bg-sky-500 hover:bg-sky-400 text-white">
              <a href="#fit"><Sparkles className="h-4 w-4 mr-2" />Which guild fits me?</a>
            </Button>
            <Button asChild size="lg" variant="outline"><Link href="/guilds">Browse guilds</Link></Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Already a member? <Link href="/login" className="underline">Sign in</Link> or <Link href="/signup" className="underline">create an account</Link> and claim your character.
          </p>
        </div>
      </section>

      {dir && (
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { icon: Shield, label: 'Active guilds', value: String(dir.network.active_guilds) },
            { icon: Users, label: 'Players', value: String(dir.network.members) },
            { icon: Coins, label: `Gold donated · ${dir.network.days}d`, value: formatGold(dir.network.gold) },
            { icon: Swords, label: `Raids · ${dir.network.days}d`, value: dir.network.raids.toLocaleString() },
          ].map((s) => (
            <Card key={s.label}><CardContent className="p-4">
              <p className="flex items-center gap-2 text-xs text-muted-foreground"><s.icon className="h-3.5 w-3.5" />{s.label}</p>
              <p className="text-2xl font-bold mt-1">{s.value}</p>
            </CardContent></Card>
          ))}
        </section>
      )}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map((f) => (
          <div key={f.title} className="space-y-2">
            <f.icon className="h-6 w-6 text-sky-400" />
            <h3 className="font-semibold">{f.title}</h3>
            <p className="text-sm text-muted-foreground">{f.text}</p>
          </div>
        ))}
      </section>

      <section id="fit" className="scroll-mt-20">
        {dir ? <GuildFitPicker guilds={active} /> : failed ? null : (
          <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        )}
      </section>

      {showcase.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-end justify-between">
            <h2 className="text-2xl font-semibold">The guilds</h2>
            <Link href="/guilds" className="text-sm text-sky-400 hover:underline">Full directory</Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {showcase.map((g) => <GuildCard key={g.id} guild={g} />)}
          </div>
        </section>
      )}

      {failed && <p className="text-sm text-muted-foreground">Couldn&apos;t load the guild list. <Link href="/guilds" className="underline">Try the directory</Link>.</p>}
    </div>
  );
}
