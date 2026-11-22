import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { requireUser, isResponse } from '@/lib/user-auth';

export const dynamic = 'force-dynamic';

const COLS = 'id, profile_id, name, data, updated_at';

/** POST /api/combat/setups { id?, profile_id, name, data } — create or overwrite a saved setup. */
export async function POST(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  const auth = { user };

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 60) : '';
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });

  const supabase = createAdminClient();
  const row = {
    user_id: auth.user.id,
    profile_id: body.profile_id ?? null,
    name,
    data: body.data ?? {},
    updated_at: new Date().toISOString(),
  };

  const q = body.id
    ? supabase.from('combat_setups').update(row).eq('id', body.id).eq('user_id', auth.user.id)
    : supabase.from('combat_setups').insert(row);
  const { data, error } = await q.select(COLS).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ setup: data });
}

/** DELETE /api/combat/setups?id= */
export async function DELETE(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  const auth = { user };

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const supabase = createAdminClient();
  const { error } = await supabase.from('combat_setups').delete().eq('id', id).eq('user_id', auth.user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
