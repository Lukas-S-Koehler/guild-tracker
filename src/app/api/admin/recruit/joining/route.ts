import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase-server';
import { staffName } from '@/lib/recruit-service';
import { endJoining, extendJoining, startJoining } from '@/lib/guild-joining-actions';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Joining state (src/lib/guild-joining.ts). Recruiting tab = deputies and up; the target guild must
 * also be one where the caller is OFFICER or above (super admin: any).
 */
async function guard(req: NextRequest, targetGuildId: string | null) {
  const auth = await verifyAuth(req, 'DEPUTY');
  if (auth instanceof NextResponse) return auth;
  const supabase = createAdminClient();
  if (targetGuildId && !auth.isSuperAdmin) {
    const { data } = await supabase
      .from('guild_leaders')
      .select('role')
      .eq('user_id', auth.user.id)
      .eq('guild_id', targetGuildId)
      .in('role', ['OFFICER', 'DEPUTY', 'LEADER'])
      .maybeSingle();
    if (!data) return NextResponse.json({ error: 'You can only mark players as joining a guild you are staff in' }, { status: 403 });
  }
  const actor = { id: auth.user.id, name: await staffName(supabase, auth.user.id, auth.guildId) };
  return { supabase, actor };
}

async function prospectGuild(id: string) {
  const { data } = await createAdminClient().from('recruit_prospects').select('joining_guild_id').eq('id', id).maybeSingle();
  return (data?.joining_guild_id as string | null) ?? null;
}

/** Start. Body: { ign, guild_id, hours? } */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { ign?: string; guild_id?: string; hours?: number } | null;
  const ign = body?.ign?.trim();
  if (!ign || !/^[A-Za-z0-9_]{2,30}$/.test(ign)) return NextResponse.json({ error: 'Valid ign required' }, { status: 400 });
  if (!body?.guild_id) return NextResponse.json({ error: 'guild_id required' }, { status: 400 });
  const g = await guard(req, String(body.guild_id));
  if (g instanceof NextResponse) return g;
  const res = await startJoining(g.supabase, { ign, guild_id: String(body.guild_id), hours: body.hours }, g.actor);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json(res);
}

/** Extend. Body: { id, hours } */
export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { id?: string; hours?: number } | null;
  if (!body?.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const g = await guard(req, await prospectGuild(body.id));
  if (g instanceof NextResponse) return g;
  const res = await extendJoining(g.supabase, body.id, Number(body.hours) || 24, g.actor);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json(res);
}

/** Cancel. ?id= */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const g = await guard(req, await prospectGuild(id));
  if (g instanceof NextResponse) return g;
  await endJoining(g.supabase, id, g.actor);
  return NextResponse.json({ ok: true });
}
