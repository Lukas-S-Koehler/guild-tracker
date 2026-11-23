import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { requireUser, isResponse } from '@/lib/user-auth';
import { getAccountCharacters } from '@/lib/account-service';
import { accountProgress } from '@/lib/achievement-eval';
import { ACHIEVEMENT_BY_KEY, grantsTitle } from '@/lib/achievements';

export const dynamic = 'force-dynamic';

/** GET /api/me/achievements — the signed-in user's account achievements, progress and title. */
export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  const supabase = createAdminClient();
  try {
    const chars = await getAccountCharacters(user.id, supabase);
    if (!chars.length) return NextResponse.json({ claimed: false });
    const data = await accountProgress(supabase, chars.map((c) => c.member_id), user.id);
    return NextResponse.json({ claimed: true, ...data });
  } catch (e) {
    console.error('[me/achievements]', e);
    return NextResponse.json({ error: 'Failed to load achievements' }, { status: 500 });
  }
}

/** PUT /api/me/achievements { title: key | null } — pick a title (Gold+ achievement of the account). */
export async function PUT(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  const supabase = createAdminClient();
  const body = await req.json().catch(() => ({}));
  const key: string | null = typeof body?.title === 'string' ? body.title : null;

  if (!key) {
    await supabase.from('user_titles').delete().eq('user_id', user.id);
    return NextResponse.json({ ok: true, title: null });
  }
  const def = ACHIEVEMENT_BY_KEY.get(key);
  if (!def || !grantsTitle(def)) return NextResponse.json({ error: 'Not a title' }, { status: 400 });

  const chars = await getAccountCharacters(user.id, supabase);
  const { data: owned } = await supabase
    .from('achievement_unlocks')
    .select('achievement_key')
    .eq('achievement_key', key)
    .in('member_id', chars.map((c) => c.member_id))
    .limit(1);
  if (!owned?.length) return NextResponse.json({ error: 'Achievement not unlocked' }, { status: 403 });

  const { error } = await supabase
    .from('user_titles')
    .upsert({ user_id: user.id, achievement_key: key, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, title: { key, name: def.name } });
}
