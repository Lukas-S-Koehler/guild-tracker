import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, ArrowRight, Coins, Crown, Shield, Swords, Users, Hammer, PiggyBank } from 'lucide-react';
import { createAdminClient } from '@/lib/supabase-server';
import { findGuildByTag, loadGuildDirectory } from '@/lib/guild-directory';
import { ASSAULT_ENTRY_GUILD_ID, ASSAULT_TOP_GUILD_ID, ASSAULT_TOP_MIN_CL, raidLabel } from '@/lib/raids';
import { formatGold } from '@/lib/utils';
import { levelLabel, requirementLabel } from '@/components/guilds/GuildCard';
import MemberShortcut from '@/components/guilds/MemberShortcut';

export const dynamic = 'force-dynamic';

type Props = { params: { tag: string } };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const dir = await loadGuildDirectory(createAdminClient());
  const g = findGuildByTag(dir, params.tag);
  if (!g) return { title: 'Guild not found' };
  return {
    title: `${g.name} [${g.tag}]`,
    description: `${g.name}: ${levelLabel(g)}, ${g.is_assault ? 'assaults' : g.raids.map(raidLabel).join(', ') || 'raids'}, ${requirementLabel(g)}.`,
  };
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-bold">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

export default async function GuildPage({ params }: Props) {
  const dir = await loadGuildDirectory(createAdminClient());
  const g = findGuildByTag(dir, params.tag);
  if (!g) notFound();

  const ladder = dir.guilds.filter((x) => x.is_active && !x.is_assault).sort((a, b) => a.min_level - b.min_level || a.display_order - b.display_order);
  const onLadder = ladder.some((x) => x.id === g.id);
  // Neighbours by level tier: guilds sharing a min level (DT/DR) are siblings, not a step up.
  const below = onLadder ? [...ladder].reverse().find((x) => x.min_level < g.min_level) ?? null : null;
  const above = onLadder ? ladder.find((x) => x.min_level > g.min_level) ?? null : null;
  const siblings = onLadder ? ladder.filter((x) => x.min_level === g.min_level && x.id !== g.id) : [];
  const de = dir.guilds.find((x) => x.id === ASSAULT_ENTRY_GUILD_ID && x.is_active);
  const di = dir.guilds.find((x) => x.id === ASSAULT_TOP_GUILD_ID && x.is_active);
  const topOfLadder = onLadder && !above;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <Link href="/guilds" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
        <ArrowLeft className="h-3.5 w-3.5" /> All guilds
      </Link>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-bold">{g.name}</h1>
            <span className="text-muted-foreground">[{g.tag}]</span>
            <Badge variant="outline" className={g.is_assault ? 'border-red-500/50 text-red-400' : 'border-crystal/50 text-crystal'}>{levelLabel(g)}</Badge>
            {!g.is_active && <Badge variant="outline" className="border-orange-500/50 text-orange-400">Closed</Badge>}
          </div>
          <p className="text-muted-foreground mt-1">
            {g.is_assault
              ? g.id === ASSAULT_TOP_GUILD_ID
                ? `Hardcore assault guild for CL ${ASSAULT_TOP_MIN_CL}+. No raids.`
                : 'Energizing Pools guild open to every level: up to 12% Magic Find and 15% EXP from the pool, casual assaults on the side. No raids.'
              : `Raid guild for combat level ${g.min_level > 1 ? `${g.min_level}+` : '1 and up'}.`}
          </p>
        </div>
        <MemberShortcut guildId={g.id} />
      </div>

      {!g.is_active && (
        <Card className="border-orange-500/40"><CardContent className="p-4 text-sm">
          This guild is not recruiting right now. <Link href="/guilds" className="underline">See the active guilds</Link>.
        </CardContent></Card>
      )}

      <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
        <Stat label="Members" value={String(g.member_count)} />
        <Stat label={`Gold donated · ${g.stats.days}d`} value={formatGold(g.stats.gold)} />
        {g.is_assault ? <Stat label="Raids" value="None" sub="Assault guild" /> : <Stat label={`Raids · ${g.stats.days}d`} value={g.stats.raids.toLocaleString()} />}
        <Stat
          label={g.stats.met_rate != null ? `Requirement met · ${g.stats.days}d` : `Active members · ${g.stats.days}d`}
          value={g.stats.met_rate != null ? `${Math.round(g.stats.met_rate * 100)}%` : String(g.stats.active_members)}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Swords className="h-4 w-4" />{g.is_assault ? 'Content' : 'Raids'}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {g.is_assault ? (
              g.id === ASSAULT_ENTRY_GUILD_ID ? (
                <p className="text-sm text-muted-foreground">No scheduled raids. The guild hall runs Energizing Pools: boosts scale with your Guild Mastery, up to 12% Magic Find and 15% EXP. Members also join casual conquest assaults.</p>
              ) : (
                <p className="text-sm text-muted-foreground">No scheduled raids. The guild fights conquest zones together: waves, marks and territory boosts for the top guilds, with shard rewards each season.</p>
              )
            ) : g.raids.length === 0 ? (
              <p className="text-sm text-muted-foreground">Raid not set yet.</p>
            ) : (
              g.raids.map((r) => (
                <div key={r.key} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
                  <div className="min-w-0">
                    <p className="font-medium truncate">CL {r.min_cl} raids</p>
                    <p className="text-xs text-muted-foreground truncate">{r.name} · {r.location} · {r.minutes} min</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm">{r.marks} marks</p>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Coins className="h-4 w-4" />Requirements</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>{requirementLabel(g)}</p>
            <p className="text-muted-foreground">
              Activity is checked once a day (11:48 UTC). Missing the requirement leads to warnings, then a kick.
            </p>
            {g.overflow.enabled && g.overflow.limit > 0 && g.requirement.amount > 0 && (
              <p className="flex items-start gap-2 text-muted-foreground">
                <PiggyBank className="h-4 w-4 mt-0.5 shrink-0" />
                Overflow bank: extra gold is saved (up to {formatGold(g.overflow.limit)}) and covers days you can&apos;t donate.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4" />Leadership</CardTitle></CardHeader>
          <CardContent>
            {g.leadership.length === 0 ? (
              <p className="text-sm text-muted-foreground">No leadership listed.</p>
            ) : (
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {g.leadership.map((m) => (
                  <li key={m.ign} className="flex items-center gap-2 min-w-0">
                    {m.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={m.avatar_url} alt="" className="h-7 w-7 rounded-full object-cover shrink-0" />
                    ) : (
                      <span className="h-7 w-7 rounded-full bg-muted shrink-0" />
                    )}
                    <span className="truncate text-sm">{m.ign}</span>
                    <span className="ml-auto text-xs text-muted-foreground inline-flex items-center gap-1 shrink-0">
                      {m.position === 'LEADER' ? <Crown className="h-3 w-3 text-yellow-500" /> : <Shield className="h-3 w-3" />}
                      {m.position.charAt(0) + m.position.slice(1).toLowerCase()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Hammer className="h-4 w-4" />Guild hall</CardTitle></CardHeader>
          <CardContent>
            {g.buildings.length === 0 ? (
              <p className="text-sm text-muted-foreground">No buildings yet.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {g.buildings.map((b) => <Badge key={b} variant="outline">{b}</Badge>)}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3 text-sm">
          <div className="flex flex-wrap gap-4">
            {below && (
              <Link href={`/guilds/${below.tag.toLowerCase()}`} className="inline-flex items-center gap-1 hover:underline">
                <ArrowLeft className="h-3.5 w-3.5" /> {below.name} ({levelLabel(below)})
              </Link>
            )}
            {siblings.map((x) => (
              <Link key={x.id} href={`/guilds/${x.tag.toLowerCase()}`} className="inline-flex items-center gap-1 hover:underline">
                Same tier: {x.name}
              </Link>
            ))}
            {above && (
              <Link href={`/guilds/${above.tag.toLowerCase()}`} className="inline-flex items-center gap-1 hover:underline">
                Next up: {above.name} ({levelLabel(above)}) <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            )}
            {topOfLadder && de && (
              <Link href={`/guilds/${de.tag.toLowerCase()}`} className="inline-flex items-center gap-1 hover:underline">
                Top raid tier. Pools or assaults? {de.name} <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            )}
            {g.id === ASSAULT_ENTRY_GUILD_ID && di && (
              <Link href={`/guilds/${di.tag.toLowerCase()}`} className="inline-flex items-center gap-1 hover:underline">
                Hardcore assaults at CL {ASSAULT_TOP_MIN_CL}+: {di.name} <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            )}
          </div>
          <Link href="/guilds#fit" className="text-crystal hover:underline">Not sure? Find your guild by CL</Link>
        </CardContent>
      </Card>
    </div>
  );
}
