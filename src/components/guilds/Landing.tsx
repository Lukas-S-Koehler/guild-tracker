'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Loader2, Swords, Droplets, ArrowRight, Check } from 'lucide-react';
import { PERK_GROUPS } from '@/lib/hub-perks';
import type { GuildDirectory } from '@/lib/guild-directory';
import { raidTiers } from '@/lib/guild-fit';
import { ASSAULT_ENTRY_GUILD_ID, ASSAULT_TOP_GUILD_ID, ASSAULT_TOP_MIN_CL } from '@/lib/raids';
import GuildFitPicker from '@/components/guilds/GuildFitPicker';
import { DreamMark } from '@/components/brand/DreamMark';

/**
 * Logged-out home. Two jobs only: (1) what the Dream Guilds are and do, (2) how to join.
 * Everything else (full directory, guild pages) is one click away.
 */
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
  // Every raid CL the network runs, linked to the guild that runs it (e.g. CL 92 → DT).
  const raidChips = Array.from(
    new Map(
      raidTiers(active).flatMap((t) => t.guilds.flatMap((g) => (g.raids.length ? g.raids.map((r) => r.min_cl) : [t.cl]).map((cl) => [cl, g] as const)))
    ).entries()
  ).sort((a, b) => a[0] - b[0]);
  const de = active.find((g) => g.id === ASSAULT_ENTRY_GUILD_ID);
  const di = active.find((g) => g.id === ASSAULT_TOP_GUILD_ID);

  return (
    <div className="max-w-4xl mx-auto space-y-16 py-4">
      {/* 1. What the Dream Guilds are */}
      <section className="space-y-8">
        <div className="space-y-4 text-center">
          <DreamMark className="h-12 w-12 mx-auto drop-shadow-[0_0_18px_hsl(var(--crystal)/0.5)]" />
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight">The Dream Guilds</h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            {dir ? `${dir.network.active_guilds} IdleMMO guilds, ${dir.network.members} players` : 'A family of IdleMMO guilds'}, one community.
            There&apos;s a guild for every combat level, and you move up as you grow.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border bg-card card-surface p-5 space-y-3">
            <p className="flex items-center gap-2 font-semibold"><Swords className="h-4 w-4 text-crystal" />Raid guilds</p>
            <p className="text-sm text-muted-foreground">Each guild runs the raid for its CL. Hit the next CL and you move up a guild.</p>
            {raidChips.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {raidChips.map(([cl, g]) => (
                  <Link
                    key={cl}
                    href={`/guilds/${g.tag.toLowerCase()}`}
                    title={`CL ${cl} raids: ${g.name}`}
                    className="rounded-md border border-crystal/30 bg-crystal/5 px-2 py-1 text-xs font-medium hover:border-crystal/60"
                  >
                    CL {cl}
                  </Link>
                ))}
              </div>
            )}
          </div>
          <div className="rounded-lg border bg-card card-surface p-5 space-y-3">
            <p className="flex items-center gap-2 font-semibold"><Droplets className="h-4 w-4 text-crystal" />Pools &amp; assaults</p>
            <p className="text-sm text-muted-foreground">No raids here. Boost your gains in the pool guild, or fight conquests for territory and shards.</p>
            <ul className="text-sm space-y-1.5">
              {de && (
                <li>
                  <Link href={`/guilds/${de.tag.toLowerCase()}`} className="font-medium hover:underline">{de.name}</Link>
                  <span className="text-muted-foreground"> · Energizing Pools guild, every level. Casual assaults on the side.</span>
                </li>
              )}
              {di && (
                <li>
                  <Link href={`/guilds/${di.tag.toLowerCase()}`} className="font-medium hover:underline">{di.name}</Link>
                  <span className="text-muted-foreground"> · hardcore assaults, CL {ASSAULT_TOP_MIN_CL}+</span>
                </li>
              )}
            </ul>
          </div>
        </div>
      </section>

      {/* What you get: game + Discord + site, from src/lib/hub-perks.ts */}
      <section className="space-y-6">
        <div className="text-center space-y-1">
          <h2 className="text-2xl font-semibold">More than a guild</h2>
          <p className="text-muted-foreground">The game, the Discord and this site work together, and they keep getting better.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {PERK_GROUPS.map((g) => (
            <div key={g.area} className="rounded-lg border bg-card card-surface p-5 space-y-3">
              <p className="font-semibold">{g.title}</p>
              <ul className="space-y-2">
                {g.perks.map((p) => (
                  <li key={p} className="flex gap-2 text-sm text-muted-foreground">
                    <Check className="h-4 w-4 mt-0.5 shrink-0 text-crystal" />
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* 2. Join */}
      <section className="space-y-6">
        <h2 className="text-2xl font-semibold text-center">Join in three steps</h2>
        <ol className="space-y-4">
          <li className="rounded-lg border border-crystal/30 bg-card card-surface p-5 space-y-4">
            <Step n={1} title="Find your guild" />
            {dir ? <GuildFitPicker guilds={active} /> : failed ? (
              <p className="text-sm text-muted-foreground">Couldn&apos;t load the guilds. <Link href="/guilds" className="underline">Open the directory</Link>.</p>
            ) : (
              <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            )}
          </li>
          <li className="rounded-lg border bg-card card-surface p-5">
            <Step n={2} title="Apply in game" text="Search the guild's tag in IdleMMO's guild list and send a join request." />
          </li>
          <li className="rounded-lg border bg-card card-surface p-5 space-y-3">
            <Step n={3} title="Claim your character here" text="Create an account and claim your character to get your own dashboard, streaks and guild progress." />
            <div className="flex flex-wrap gap-2 pl-10">
              <Button asChild size="sm"><Link href="/signup">Create account</Link></Button>
              <Button asChild size="sm" variant="ghost"><Link href="/login">Sign in</Link></Button>
            </div>
          </li>
        </ol>
        <p className="text-center text-sm">
          <Link href="/guilds" className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
            Browse every guild <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </p>
      </section>
    </div>
  );
}

function Step({ n, title, text }: { n: number; title: string; text?: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-crystal/15 text-sm font-semibold text-crystal">{n}</span>
      <div>
        <p className="font-semibold">{title}</p>
        {text && <p className="text-sm text-muted-foreground">{text}</p>}
      </div>
    </div>
  );
}
