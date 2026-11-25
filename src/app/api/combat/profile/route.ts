import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { requireUser, isResponse } from '@/lib/user-auth';
import { getAccountCharacters } from '@/lib/account-service';
import { huntingBow } from '@/lib/combat/hunting-gear';
import { fetchCharacterSnapshot, PROFILE_COLUMNS, canCalibrateStats } from '@/lib/combat/profile-service';

export const dynamic = 'force-dynamic';

/** POST /api/combat/profile { member_id } — open (create + sync) a combat profile for one of your characters. */
export async function POST(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  const auth = { user };

  const { member_id } = await req.json().catch(() => ({}));
  if (!member_id) return NextResponse.json({ error: 'member_id required' }, { status: 400 });

  const supabase = createAdminClient();
  const chars = await getAccountCharacters(user.id, supabase);
  const member = chars.find((c) => c.member_id === member_id);
  if (!member) return NextResponse.json({ error: 'That character is not on your account' }, { status: 403 });
  if (!member.in_dream_guild || !member.hashed_id) {
    return NextResponse.json({ error: `${member.ign} is not in a Dream guild right now` }, { status: 403 });
  }

  try {
    const snap = await fetchCharacterSnapshot(auth.user.id, member.hashed_id);
    const { pets_available, keep_stored_pets, notice, pets, key_source: _src, ...row } = snap;
    const { data, error } = await supabase
      .from('combat_profiles')
      .upsert(
        {
          user_id: auth.user.id,
          member_id: member.member_id,
          hashed_id: member.hashed_id,
          ...row,
          ...(keep_stored_pets ? {} : { pets }),
          last_sync: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,hashed_id' }
      )
      .select(PROFILE_COLUMNS)
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ profile: data, pets_available, notice });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Sync failed' }, { status: 502 });
  }
}

/** PATCH /api/combat/profile { id, gear?, settings?, hunting_bow? } — save member-entered gear and settings. */
export async function PATCH(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  const auth = { user };

  const body = await req.json().catch(() => ({}));
  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (Array.isArray(body.gear)) patch.gear = body.gear;
  const supabase = createAdminClient();
  if (body.settings && typeof body.settings === 'object') {
    const settings = { ...body.settings };
    // Stat calibration is assaulters only: everyone else keeps whatever is stored (normally none).
    if (!(await canCalibrateStats(user.id, await getAccountCharacters(user.id, supabase), supabase))) {
      const { data: cur } = await supabase
        .from('combat_profiles')
        .select('settings')
        .eq('id', body.id)
        .eq('user_id', auth.user.id)
        .maybeSingle();
      const stored = (cur?.settings as Record<string, unknown> | null)?.manual;
      if (stored === undefined) delete settings.manual;
      else settings.manual = stored;
    }
    patch.settings = settings;
  }

  // Hunting bow (optional) lives on the character, shared with /assault/roster.
  if (body.hunting_bow !== undefined) {
    const bow = body.hunting_bow ? huntingBow(body.hunting_bow) : null;
    if (body.hunting_bow && !bow) return NextResponse.json({ error: 'Unknown bow' }, { status: 400 });
    const { data: own } = await supabase.from('combat_profiles').select('member_id').eq('id', body.id).eq('user_id', auth.user.id).maybeSingle();
    if (!own?.member_id) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    await supabase.from('members').update({ hunting_bow: bow?.name ?? null }).eq('id', own.member_id);
  }

  const { data, error } = await supabase
    .from('combat_profiles')
    .update(patch)
    .eq('id', body.id)
    .eq('user_id', auth.user.id)
    .select(PROFILE_COLUMNS)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ profile: data });
}

/** DELETE /api/combat/profile?id= — unlink a character. */
export async function DELETE(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  const auth = { user };

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const supabase = createAdminClient();
  const { error } = await supabase.from('combat_profiles').delete().eq('id', id).eq('user_id', auth.user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
