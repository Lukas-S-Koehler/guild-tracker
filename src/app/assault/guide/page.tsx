'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  ArrowLeft,
  ExternalLink,
  FlaskConical,
  Map,
  Swords,
  Zap,
  Target,
  Shield,
  Trophy,
  Crown,
  Clock,
} from 'lucide-react';
import { HITS_TO_KILL, FIVE_PS, GEAR_LINK, TERRITORY_BOOSTS as SHARED_TERRITORY, EXP_REWARDS as SHARED_EXP, KILL_REWARDS as SHARED_KILL } from '@/lib/assault-plan-static';

const DEFAULT_ZONE = 'Isle of Whispers';
const SHARD_ICON = 'https://cdn.idle-mmo.com/cdn-cgi/image/width=20,height=20,format=auto/uploaded/skins/01JVYWCX6QE35GBJQ9TV02G033.png';

interface PlanEnemy {
  id: number;
  name: string;
  level: number;
  zone_name: string;
  gph: number;
  drop_count: number;
}

interface ZonePlanResponse {
  zone: string;
  enemies: PlanEnemy[];
  total_gph: number;
  level_min: number | null;
  level_max: number | null;
  shrine_info: string;
}

const RANK_TONES: Record<string, string> = {
  '1st': 'text-yellow-500',
  '2nd': 'text-slate-400',
  '3rd': 'text-amber-700',
};
const toneFor = (place: string) => RANK_TONES[place] ?? 'text-muted-foreground';
const TERRITORY_BOOSTS = SHARED_TERRITORY.map((b) => ({ ...b, tone: toneFor(b.place) }));
const EXP_REWARDS = SHARED_EXP;
const KILL_REWARDS = SHARED_KILL;

function ShardIcon({ className = 'h-4 w-4 inline-block align-text-bottom' }: { className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={SHARD_ICON} alt="Shards" className={className} />;
}

function ShardAmount({ amount }: { amount: number }) {
  return (
    <span className="inline-flex items-center gap-1 font-mono tabular-nums">
      {amount.toLocaleString()}
      <ShardIcon />
    </span>
  );
}

function RankBadge({ place, tone }: { place: string; tone?: string }) {
  return (
    <span className={`font-semibold ${tone ?? ''}`}>{place}</span>
  );
}

export default function AssaultGuidePage() {
  const [zones, setZones] = useState<string[]>([]);
  const [selectedZone, setSelectedZone] = useState<string>(DEFAULT_ZONE);
  const [plan, setPlan] = useState<ZonePlanResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch('/api/assault/plan/zones')
      .then((r) => r.json())
      .then((d) => setZones(d.zones ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedZone) return;
    setLoading(true);
    fetch(`/api/assault/plan?zone=${encodeURIComponent(selectedZone)}`)
      .then((r) => r.json())
      .then((d) => setPlan(d))
      .finally(() => setLoading(false));
  }, [selectedZone]);

  const levelRange =
    plan?.level_min != null && plan?.level_max != null
      ? plan.level_min === plan.level_max
        ? `Lv ${plan.level_min}`
        : `Lv ${plan.level_min}–${plan.level_max}`
      : '';

  return (
    <div className="container mx-auto p-4 max-w-5xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Link href="/assault">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Assault
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Swords className="h-6 w-6 text-primary" />
              Assault Guide
            </h1>
            <p className="text-sm text-muted-foreground">Everything you need to plan, launch, and win conquests.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/assault/potions">
            <Button variant="outline" size="sm">
              <FlaskConical className="h-4 w-4 mr-1" />
              Potion Planner
            </Button>
          </Link>
        </div>
      </div>

      {/* Zone plan */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Map className="h-5 w-5 text-primary" />
                Zone Plan
              </CardTitle>
              <CardDescription>Kill priority by live gold/hr. Prices sync daily.</CardDescription>
            </div>
            <Select value={selectedZone} onValueChange={setSelectedZone}>
              <SelectTrigger className="w-[260px]">
                <SelectValue placeholder="Pick a zone" />
              </SelectTrigger>
              <SelectContent>
                {zones.map((z) => (
                  <SelectItem key={z} value={z}>
                    {z}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {loading && <p className="text-muted-foreground">Loading…</p>}
          {!loading && plan && plan.enemies.length === 0 && (
            <p className="text-muted-foreground">
              No enemies cached for this zone yet. Run <code>combat-enemies-sync</code>.
            </p>
          )}
          {!loading && plan && plan.enemies.length > 0 && (
            <>
              <div className="flex flex-wrap gap-2">
                {levelRange && <Badge variant="secondary">{levelRange}</Badge>}
                <Badge variant="secondary">{plan.shrine_info}</Badge>
                <Badge className="bg-primary/10 text-primary hover:bg-primary/15 border-primary/20">
                  Best: {plan.total_gph.toLocaleString()} g/h
                </Badge>
              </div>
              <p className="text-muted-foreground">
                Stockpile <strong className="text-foreground">4,000–10,000+ mobs</strong> (+10–20% flee buffer).
                Hunting pet Lv {plan.level_min ?? '?'}+ required to auto-hunt here.
              </p>
              <div className="rounded-lg border divide-y">
                {plan.enemies.map((e, i) => (
                  <div key={e.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="w-6 text-right text-xs font-mono text-muted-foreground">#{i + 1}</span>
                      <div className="min-w-0">
                        <div className="font-medium truncate">{e.name}</div>
                        <div className="text-xs text-muted-foreground">
                          Lv {e.level} · {e.drop_count} drops
                        </div>
                      </div>
                    </div>
                    <span className="font-mono text-sm tabular-nums">{e.gph.toLocaleString()} g/h</span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Pick lowest level × highest gold. Scale up only if hits-to-kill stays low.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* 5 Ps */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            Prep Sequence
          </CardTitle>
          <CardDescription>Do these in order, every launch.</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="space-y-2">
            {FIVE_PS.map((p, i) => (
              <li key={p.when} className="flex gap-3">
                <span className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/10 text-primary font-bold text-sm flex items-center justify-center">
                  {i + 1}
                </span>
                <div className="flex-1">
                  <div className="font-semibold">{p.when}</div>
                  <div className="text-sm text-muted-foreground">{p.text}</div>
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      {/* Potions */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5 text-primary" />
            Potions
          </CardTitle>
          <CardDescription>4 slots: Battle XP · Combat XP · Attack · Protection. One potion per slot.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="rounded-lg border p-3">
              <div className="font-semibold text-primary mb-1">Battle XP</div>
              <div className="text-muted-foreground text-xs">
                POTG (free from campaign/dailies), Dragonblood Tonic, Vortex Brew, Battle Potion, Strike Essence.
              </div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="font-semibold text-primary mb-1">Combat XP</div>
              <div className="text-muted-foreground text-xs">
                Wraithbane Essence, Dungeon Master&apos;s Tonic, Dungeon Potion. Sun&apos;s Light if burning gold.
              </div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="font-semibold text-primary mb-1">Attack</div>
              <div className="text-muted-foreground text-xs">
                Frenzy, Bladeburst, Dragon&apos;s Essence. Pair with Bulwark Brew.
              </div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="font-semibold text-primary mb-1">Protection</div>
              <div className="text-muted-foreground text-xs">
                Shieldbearer&apos;s Infusion, Bulwark Brew, Guardian&apos;s Soul.
              </div>
            </div>
            <div className="rounded-lg border p-3 sm:col-span-2 bg-muted/30">
              <div className="font-semibold mb-1">Combo (fills attack + protection)</div>
              <div className="text-muted-foreground text-xs">Thunderfury Brew, Cosmic Tear, Phoenix Ashes.</div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Can&apos;t stack two potions of the same type — Strike Essence + POTG both give Battle XP so only one applies.
          </p>
          <Link href="/assault/potions" className="inline-flex items-center gap-1 text-primary hover:underline text-sm">
            Open Potion Planner <ExternalLink className="h-3 w-3" />
          </Link>
        </CardContent>
      </Card>

      {/* Hits to kill */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5 text-primary" />
            Hits-to-Kill Reference
          </CardTitle>
          <CardDescription>Target 2–3 hits for max throughput.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-muted-foreground text-xs">
                <tr>
                  <th className="text-left px-3 py-2">Hits</th>
                  <th className="text-left px-3 py-2">Time / Kill</th>
                  <th className="text-left px-3 py-2">Kills / 9h Window</th>
                </tr>
              </thead>
              <tbody>
                {HITS_TO_KILL.map((h) => (
                  <tr key={h.hits} className="border-t">
                    <td className="px-3 py-1.5 font-mono">{h.hits}</td>
                    <td className="px-3 py-1.5">{h.time}</td>
                    <td className="px-3 py-1.5 font-mono tabular-nums">{h.kills}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Gear */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            Gear
          </CardTitle>
          <CardDescription>BiS3+ legendary recommended for Isle of Whispers.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm space-y-2">
          <p>Reference gear tiers and upgrades on the external tracker:</p>
          <a
            href={GEAR_LINK}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            dungeon-tracker-seven.vercel.app/gear <ExternalLink className="h-3 w-3" />
          </a>
          <p className="text-muted-foreground text-xs">
            Below Lv 70 just buy market gear. From Lv 90+ mythic gear & upgrade stones get expensive.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Swords className="h-5 w-5 text-primary" />
            Conquest Mechanics
          </CardTitle>
          <CardDescription>How EXP, territory, and rewards work.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 text-sm">
          {/* EXP split */}
          <div>
            <div className="font-semibold mb-2 flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" /> EXP split per kill
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {[
                { label: 'Guild EXP', pct: '5%' },
                { label: 'Conquest EXP', pct: '5%' },
                { label: 'Guild Mastery EXP', pct: '5%' },
              ].map((x) => (
                <div key={x.label} className="rounded-lg border bg-muted/30 px-3 py-2">
                  <div className="text-xs text-muted-foreground">{x.label}</div>
                  <div className="text-lg font-bold text-primary">{x.pct}</div>
                </div>
              ))}
            </div>
            <ul className="list-disc pl-5 space-y-0.5 mt-3 text-muted-foreground">
              <li>Rounded down per enemy. Potions/buffs boost all three.</li>
              <li>Min guild EXP ignores negative class effects (e.g. Forsaken −50%).</li>
              <li>Higher-level / scaled enemies yield more EXP.</li>
              <li>
                Only battles started <em>after</em> assault launch count.
              </li>
            </ul>
          </div>

          {/* Waves */}
          <div>
            <div className="font-semibold mb-2 flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" /> Waves & cost
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border bg-muted/30 px-3 py-2">
                <div className="text-xs text-muted-foreground">Wave length</div>
                <div className="font-semibold">1 hour</div>
              </div>
              <div className="rounded-lg border bg-muted/30 px-3 py-2">
                <div className="text-xs text-muted-foreground">Cost / wave</div>
                <div className="font-semibold">1 mark</div>
              </div>
            </div>
          </div>

          {/* Territory boosts */}
          <div>
            <div className="font-semibold mb-2 flex items-center gap-2">
              <Crown className="h-4 w-4 text-primary" /> Territory boosts (next season)
            </div>
            <p className="text-muted-foreground mb-2">
              Top 10 guilds by zone EXP rule next season. Boost applies to Primary Skill EXP, Dungeon/World Boss/Combat/Hunting/Slayer EXP, and Dungeon/World Boss Magic Find.
            </p>
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-muted-foreground text-xs">
                  <tr>
                    <th className="text-left px-3 py-2">Rank</th>
                    <th className="text-right px-3 py-2">EXP / Magic Find</th>
                    <th className="text-right px-3 py-2">Primary Skill Eff</th>
                  </tr>
                </thead>
                <tbody>
                  {TERRITORY_BOOSTS.map((b) => (
                    <tr key={b.place} className="border-t">
                      <td className="px-3 py-1.5">
                        <RankBadge place={b.place} tone={b.tone} />
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums">+{b.expMf}%</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums">+{b.eff}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Combat EXP bonus applies only during the 14-day assault cooldown window (seasons starting on or after 2026-06-01).
            </p>
          </div>

          {/* Shard rewards */}
          <div>
            <div className="font-semibold mb-2 flex items-center gap-2">
              <Trophy className="h-4 w-4 text-primary" /> Individual shard rewards
              <ShardIcon />
            </div>
            <p className="text-muted-foreground mb-2">
              Two leaderboards per zone — EXP contribution & kills. You can place on both. Rewards stack across zones.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="rounded-lg border overflow-hidden">
                <div className="bg-muted/50 px-3 py-2 text-xs font-semibold flex items-center gap-2">
                  <Zap className="h-3.5 w-3.5" /> EXP leaderboard
                </div>
                <table className="w-full text-sm">
                  <tbody>
                    {EXP_REWARDS.map((r, i) => (
                      <tr key={r.place} className="border-t">
                        <td className="px-3 py-1.5">
                          <RankBadge
                            place={r.place}
                            tone={i === 0 ? 'text-yellow-500' : i === 1 ? 'text-slate-400' : i === 2 ? 'text-amber-700' : undefined}
                          />
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          <ShardAmount amount={r.shards} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="rounded-lg border overflow-hidden">
                <div className="bg-muted/50 px-3 py-2 text-xs font-semibold flex items-center gap-2">
                  <Target className="h-3.5 w-3.5" /> Kills leaderboard
                </div>
                <table className="w-full text-sm">
                  <tbody>
                    {KILL_REWARDS.map((r, i) => (
                      <tr key={r.place} className="border-t">
                        <td className="px-3 py-1.5">
                          <RankBadge
                            place={r.place}
                            tone={i === 0 ? 'text-yellow-500' : i === 1 ? 'text-slate-400' : i === 2 ? 'text-amber-700' : undefined}
                          />
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          <ShardAmount amount={r.shards} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
