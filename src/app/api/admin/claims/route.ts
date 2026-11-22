import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { findBundleLocks, getActiveClaim, recomputeUserGuildAccess, reviewableGuildIds } from '@/lib/account-service';
import { requireUser, isResponse, displayNameOf } from '@/lib/user-auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/claims?status=pending|approved|rejected
 * Claims for characters in guilds the caller can review
 * (super admin: all; LEADER/DEPUTY/OFFICER: their guilds).
 */
export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;

  const supabase = createAdminClient();
  const allowed = await reviewableGuildIds(user, supabase);
  if (allowed && allowed.length === 0) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const status = new URL(req.url).searchParams.get('status') ?? 'pending';
  const { data, error } = await supabase
    .from('user_characters')
    .select('id, user_id, status, note, requested_at, reviewed_at, member:members!inner(id, ign, avatar_url, total_level, current_guild_id, discord_username)')
    .eq('status', status)
    .order('requested_at', { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type Row = (typeof data)[number] & { member: { current_guild_id: string | null } };
  const rows = (data as Row[]).filter((r) => !allowed || (r.member.current_guild_id && allowed.includes(r.member.current_guild_id)));

  const userIds = Array.from(new Set(rows.map((r) => r.user_id as string)));
  const names = new Map<string, string>();
  await Promise.all(
    userIds.map(async (id) => {
      const { data: u } = await supabase.auth.admin.getUserById(id);
      names.set(id, displayNameOf(u?.user ?? null));
    })
  );
  const { data: guilds } = await supabase.from('guilds').select('id, nickname, name');
  const gName = new Map((guilds ?? []).map((g) => [g.id as string, (g.nickname || g.name) as string]));

  return NextResponse.json({
    is_super_admin: allowed === null,
    claims: rows.map((r) => ({
      ...r,
      user_name: names.get(r.user_id) ?? 'Unknown user',
      guild_name: r.member.current_guild_id ? gName.get(r.member.current_guild_id) ?? null : null,
    })),
  });
}

/** POST /api/admin/claims { id, action: 'approve'|'reject'|'revoke', note? } */
export async function POST(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;

  const { id, action, note } = await req.json().catch(() => ({}));
  if (!id || !['approve', 'reject', 'revoke'].includes(action)) {
    return NextResponse.json({ error: 'id and action required' }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data: claim } = await supabase
    .from('user_characters')
    .select('id, user_id, member_id, member:members!inner(current_guild_id)')
    .eq('id', id)
    .maybeSingle();
  if (!claim) return NextResponse.json({ error: 'Claim not found' }, { status: 404 });

  const allowed = await reviewableGuildIds(user, supabase);
  const guildId = (claim.member as unknown as { current_guild_id: string | null }).current_guild_id;
  if (allowed && (!guildId || !allowed.includes(guildId))) {
    return NextResponse.json({ error: 'You can only review characters in your own guild' }, { status: 403 });
  }

  if (action === 'approve') {
    const { locks } = await findBundleLocks(claim.member_id, supabase);
    if (locks.some((l) => l.claim_id !== claim.id)) {
      return NextResponse.json({ error: 'This account (or one of its alts) already has another active claim — revoke that first' }, { status: 409 });
    }
    const active = await getActiveClaim(claim.user_id, supabase);
    if (active && active.id !== claim.id) {
      return NextResponse.json({ error: `This user already has an active claim on ${active.ign} — revoke that first` }, { status: 409 });
    }
  }

  const status = action === 'approve' ? 'approved' : 'rejected';
  const { error } = await supabase
    .from('user_characters')
    .update({ status, note: note ?? null, reviewed_by: user.id, reviewed_at: new Date().toISOString() })
    .eq('id', claim.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const access = await recomputeUserGuildAccess(claim.user_id, supabase);
  return NextResponse.json({ ok: true, status, access });
}
