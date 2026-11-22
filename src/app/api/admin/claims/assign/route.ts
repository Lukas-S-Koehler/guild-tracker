import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { findBundleLocks, getActiveClaim, recomputeUserGuildAccess, reviewableGuildIds } from '@/lib/account-service';
import { requireUser, isResponse } from '@/lib/user-auth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/claims/assign { email? | username?, member_id }
 * Directly link a character to a website account (approved immediately).
 */
export async function POST(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;

  const { email, username, member_id } = await req.json().catch(() => ({}));
  if (!member_id || (!email && !username)) {
    return NextResponse.json({ error: 'member_id and email or username required' }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data: member } = await supabase.from('members').select('id, ign, current_guild_id').eq('id', member_id).maybeSingle();
  if (!member) return NextResponse.json({ error: 'Character not found' }, { status: 404 });

  const allowed = await reviewableGuildIds(user, supabase);
  if (allowed && (!member.current_guild_id || !allowed.includes(member.current_guild_id))) {
    return NextResponse.json({ error: 'You can only assign characters in your own guild' }, { status: 403 });
  }

  const { data: found, error: rpcError } = await supabase.rpc(
    email ? 'find_user_by_email' : 'find_user_by_username',
    email ? { search_email: String(email).toLowerCase() } : { search_username: username }
  );
  if (rpcError) return NextResponse.json({ error: 'User lookup failed' }, { status: 500 });
  if (!found?.length) return NextResponse.json({ error: 'No website account found — they need to sign up first' }, { status: 404 });
  if (found.length > 1) return NextResponse.json({ error: 'Several accounts match that username — use email' }, { status: 400 });
  const targetId = found[0].id as string;

  const { locks } = await findBundleLocks(member.id, supabase);
  if (locks.some((l) => l.user_id !== targetId)) {
    return NextResponse.json({ error: `${member.ign}'s account already has an active claim by someone else — revoke that first` }, { status: 409 });
  }
  const active = await getActiveClaim(targetId, supabase);
  if (active && active.member_id !== member.id) {
    return NextResponse.json({ error: `That user already has an active claim on ${active.ign} — revoke it first` }, { status: 409 });
  }

  const { error } = await supabase.from('user_characters').upsert(
    {
      user_id: targetId,
      member_id: member.id,
      status: 'approved',
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,member_id' }
  );
  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'Conflicts with another active claim' }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const access = await recomputeUserGuildAccess(targetId, supabase);
  return NextResponse.json({ ok: true, access });
}
