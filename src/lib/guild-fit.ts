/**
 * "Which guild fits me" — pure matching on combat level (CL), playstyle and gold budget.
 * Client-safe (no DB). Fed by the public guild directory (src/lib/guild-directory.ts).
 *
 * Rules (same as the /me move-up nudge):
 * - Raid guilds (active, not assault) take a CL >= min_level. Best fit = highest min_level
 *   you qualify for, because that guild runs the highest raid you can join.
 * - Assault guilds run no raids. Dream Engineers is the entry (nominally CL 100+);
 *   Dream Invaders is the hardcore step up from DE, never a direct pick.
 */
import { ASSAULT_ENTRY_GUILD_ID, ASSAULT_MIN_CL, ASSAULT_TOP_GUILD_ID, bestRaidFor, type Raid } from '@/lib/raids';

export type Playstyle = 'raids' | 'assaults' | 'any';

export interface FitGuild {
  id: string;
  name: string;
  tag: string;
  min_level: number;
  is_assault: boolean;
  raids: Raid[];
  requirement: { period: 'daily' | 'weekly'; amount: number };
  member_count: number;
}

export interface FitResult {
  guild: FitGuild;
  /** Raids this guild runs that the CL can join. */
  joinable: Raid[];
  reasons: string[];
  warnings: string[];
  score: number;
}

export interface FitAnswer {
  best_raid: Raid | null;
  picks: FitResult[];
  /** Next guild up the raid ladder the CL doesn't reach yet. */
  next_goal: { guild: FitGuild; levels_needed: number } | null;
  assault_note: string | null;
}

/** Gold per day the guild asks for (weekly requirement spread over 7 days). */
export function dailyCost(g: FitGuild): number {
  return g.requirement.period === 'weekly' ? Math.ceil(g.requirement.amount / 7) : g.requirement.amount;
}

export function fitGuilds(guilds: FitGuild[], cl: number, playstyle: Playstyle, dailyBudget: number | null): FitAnswer {
  const ladder = guilds.filter((g) => !g.is_assault).sort((a, b) => a.min_level - b.min_level);
  const topMin = ladder.length ? ladder[ladder.length - 1].min_level : 0;
  const results: FitResult[] = [];

  if (playstyle !== 'assaults') {
    for (const g of ladder) {
      if (cl < g.min_level) continue;
      const joinable = g.raids.filter((r) => cl >= r.min_cl);
      const reasons: string[] = [];
      const warnings: string[] = [];
      // Closer to your level = better content for you. Max 100 for the guild right at your tier.
      let score = 100 - Math.min(60, (cl - g.min_level) * 2);
      if (joinable.length) {
        const top = joinable[joinable.length - 1];
        reasons.push(
          joinable.length < g.raids.length
            ? `You can join ${joinable.map((r) => r.name).join(', ')} (of ${g.raids.length} raids)`
            : `Runs ${joinable.map((r) => r.name).join(', ')}`
        );
        score += top.min_cl / 4;
      } else if (g.raids.length) {
        warnings.push(`Its raids need CL ${g.raids[0].min_cl}+`);
        score -= 40;
      }
      reasons.push(g.min_level > 1 ? `Needs CL ${g.min_level}, you have ${cl}` : 'Open to every level');
      const cost = dailyCost(g);
      if (cost === 0) reasons.push('No donation requirement');
      if (dailyBudget != null && cost > dailyBudget) {
        warnings.push(`Asks ~${cost.toLocaleString()} gold/day, above your ${dailyBudget.toLocaleString()}`);
        score -= 50;
      }
      score += Math.min(g.member_count, 50) / 100; // tie-break: livelier guild first
      results.push({ guild: g, joinable, reasons, warnings, score });
    }
  }

  let assaultNote: string | null = null;
  const de = guilds.find((g) => g.id === ASSAULT_ENTRY_GUILD_ID);
  const di = guilds.find((g) => g.id === ASSAULT_TOP_GUILD_ID);
  if (de && playstyle !== 'raids') {
    const ready = cl >= ASSAULT_MIN_CL;
    // At the top of the raid ladder there's nothing higher to raid: assaults are the next step.
    const topOfLadder = cl >= topMin;
    if (ready || playstyle === 'assaults' || topOfLadder) {
      const reasons = ['Assault guild: conquests, waves and territory instead of raids'];
      const warnings: string[] = [];
      if (!ready) warnings.push(`Assault guilds expect CL ${ASSAULT_MIN_CL}, you're ${ASSAULT_MIN_CL - cl} short (ask staff, close is often fine)`);
      const cost = dailyCost(de);
      if (dailyBudget != null && cost > dailyBudget) warnings.push(`Asks ~${cost.toLocaleString()} gold/day, above your ${dailyBudget.toLocaleString()}`);
      let score = playstyle === 'assaults' ? 200 : ready ? 120 : 60;
      score -= warnings.length * 30;
      results.push({ guild: de, joinable: [], reasons, warnings, score });
    }
    if (di) assaultNote = `${di.name} is the hardcore assault guild. Players move up from ${de.name}, not straight in.`;
  }

  results.sort((a, b) => b.score - a.score);
  let picks = results.slice(0, 4);
  // Past the top raid tier assaults are the only step left: always show DE then.
  const deResult = results.find((r) => r.guild.id === ASSAULT_ENTRY_GUILD_ID);
  if (deResult && !picks.includes(deResult)) picks = [...picks.slice(0, 3), deResult];
  const above = ladder.filter((g) => g.min_level > cl);
  const nextGoal = above.length ? { guild: above[0], levels_needed: above[0].min_level - cl } : null;
  return { best_raid: bestRaidFor(cl), picks, next_goal: nextGoal, assault_note: assaultNote };
}
