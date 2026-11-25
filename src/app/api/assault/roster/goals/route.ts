import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { requireUser, isResponse } from '@/lib/user-auth';
import { RANK, rankInGuild } from '@/lib/role-hierarchy';
import { mergeGoals, TRACKS } from '@/lib/roster-goals';

export const dynamic = 'force-dynamic';

async function assaultGuild(guildId: string) {
  const { data } = await createAdminClient().from('guilds').select('id, is_assault').eq('id', guildId).maybeSingle();
  return data?.is_assault ? data : null;
}

/** GET /api/assault/roster/goals?guild=<id> — goal tiers for one assault guild (leaders+). */
export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  const guildId = req.nextUrl.searchParams.get('guild') ?? '';
  if (!(await assaultGuild(guildId))) return NextResponse.json({ error: 'Not an assault guild' }, { status: 404 });
  const supabase = createAdminClient();
  if ((await rankInGuild(supabase, user, guildId)) < RANK.LEADER) return NextResponse.json({ error: 'Guild leaders only' }, { status: 403 });
  const { data } = await supabase.from('assault_roster_goals').select('goals, updated_at').eq('guild_id', guildId).maybeSingle();
  return NextResponse.json({ goals: mergeGoals(data?.goals), updated_at: data?.updated_at ?? null });
}

/** PUT /api/assault/roster/goals { guild_id, goals } — leaders of that guild or super admin. */
export async function PUT(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  const body = (await req.json().catch(() => ({}))) as { guild_id?: string; goals?: unknown; reset?: boolean };
  const guildId = body.guild_id ?? '';
  if (!(await assaultGuild(guildId))) return NextResponse.json({ error: 'Not an assault guild' }, { status: 404 });
  const supabase = createAdminClient();
  if ((await rankInGuild(supabase, user, guildId)) < RANK.LEADER) return NextResponse.json({ error: 'Guild leaders only' }, { status: 403 });

  if (body.reset) {
    await supabase.from('assault_roster_goals').delete().eq('guild_id', guildId);
    return NextResponse.json({ goals: mergeGoals(null) });
  }

  const goals = mergeGoals(body.goals);
  // Each tier must be harder than the one before (slayer's first slot is the eligibility rule, not a number).
  for (const t of TRACKS.filter((x) => x.editable)) {
    const ths = goals.tracks[t.id].thresholds.slice(t.id === 'slayer' ? 1 : 0);
    for (let i = 1; i < ths.length; i++) {
      if (!(ths[i] > ths[i - 1])) return NextResponse.json({ error: `${t.label}: each tier must be higher than the one before` }, { status: 400 });
    }
  }
  const { error } = await supabase
    .from('assault_roster_goals')
      .upsert({ guild_id: guildId, goals, updated_by: user.id, updated_at: new Date().toISOString() }, { onConflict: 'guild_id' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ goals });
}
