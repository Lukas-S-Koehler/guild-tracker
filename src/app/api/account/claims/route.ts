import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { findBundleLocks, getActiveClaim, recomputeUserGuildAccess } from '@/lib/account-service';
import { requireUser, isResponse } from '@/lib/user-auth';

export const dynamic = 'force-dynamic';

/** POST /api/account/claims { member_id } — request a character (pending admin approval). */
export async function POST(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;

  const { member_id } = await req.json().catch(() => ({}));
  if (!member_id) return NextResponse.json({ error: 'member_id required' }, { status: 400 });

  const supabase = createAdminClient();
  const { data: member } = await supabase
    .from('members')
    .select('id, ign, current_guild_id, is_active')
    .eq('id', member_id)
    .maybeSingle();
  if (!member) return NextResponse.json({ error: 'Character not found' }, { status: 404 });

  const { data: guild } = member.current_guild_id
    ? await supabase.from('guilds').select('id').eq('id', member.current_guild_id).maybeSingle()
    : { data: null };
  if (!guild || member.is_active === false) {
    return NextResponse.json({ error: 'Only characters currently in a Dream guild can be claimed' }, { status: 400 });
  }

  // One account per user: release the current claim before claiming another.
  const active = await getActiveClaim(user.id, supabase);
  if (active) {
    const what = active.status === 'pending' ? 'a pending claim on' : 'already claimed';
    return NextResponse.json(
      { error: `You have ${what} ${active.ign}. Release it on your account page before claiming a different account.` },
      { status: 409 }
    );
  }

  // The whole alt bundle is locked by any pending/approved claim on any of its characters.
  const { locks } = await findBundleLocks(member.id, supabase);
  if (locks.length) {
    const pending = locks.every((l) => l.status === 'pending');
    return NextResponse.json(
      {
        error: pending
          ? `${member.ign}'s account already has a pending claim. Ask an officer if that isn't you.`
          : `${member.ign}'s account is already claimed. Ask an officer if that's wrong.`,
      },
      { status: 409 }
    );
  }

  const { data, error } = await supabase
    .from('user_characters')
    .upsert(
      { user_id: user.id, member_id: member.id, status: 'pending', note: null, requested_at: new Date().toISOString(), reviewed_by: null, reviewed_at: null },
      { onConflict: 'user_id,member_id' }
    )
    .select('id, status')
    .single();
  if (error) {
    // Unique index race: someone else grabbed it between the check and the write.
    if (error.code === '23505') return NextResponse.json({ error: 'That account was just claimed by someone else' }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ claim: data });
}

/** DELETE /api/account/claims?id= — cancel a pending request or release the claimed account. */
export async function DELETE(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const supabase = createAdminClient();
  const { error } = await supabase.from('user_characters').delete().eq('id', id).eq('user_id', user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await recomputeUserGuildAccess(user.id, supabase);
  return NextResponse.json({ ok: true });
}
