import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { getAccountCharacters, recomputeUserGuildAccess } from '@/lib/account-service';
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

  const mine = await getAccountCharacters(user.id, supabase);
  if (mine.some((c) => c.member_id === member.id)) {
    return NextResponse.json({ error: `${member.ign} is already on your account (as a claim or alt)` }, { status: 400 });
  }

  const { data: owner } = await supabase
    .from('user_characters')
    .select('user_id')
    .eq('member_id', member.id)
    .eq('status', 'approved')
    .maybeSingle();
  if (owner) return NextResponse.json({ error: `${member.ign} is already claimed by another account. Ask an admin if that's wrong.` }, { status: 409 });

  const { data, error } = await supabase
    .from('user_characters')
    .upsert(
      { user_id: user.id, member_id: member.id, status: 'pending', note: null, requested_at: new Date().toISOString(), reviewed_by: null, reviewed_at: null },
      { onConflict: 'user_id,member_id' }
    )
    .select('id, status')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ claim: data });
}

/** DELETE /api/account/claims?id= — cancel a request or unlink an approved character. */
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
