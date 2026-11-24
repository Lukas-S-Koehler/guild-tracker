import { NextRequest, NextResponse } from 'next/server';
import { requireUser, isResponse } from '@/lib/user-auth';
import { syncProfile } from '@/lib/combat/profile-service';
import { createAdminClient } from '@/lib/supabase-server';
import { getAccountCharacters } from '@/lib/account-service';

export const dynamic = 'force-dynamic';

/** POST /api/combat/profile/sync { id } — refresh stats, pet, effects from IdleMMO (2 min cooldown). */
export async function POST(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  const auth = { user };

  const { id } = await req.json().catch(() => ({}));
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const supabase = createAdminClient();
  const [{ data: prof }, chars] = await Promise.all([
    supabase.from('combat_profiles').select('hashed_id').eq('id', id).eq('user_id', user.id).maybeSingle(),
    getAccountCharacters(user.id, supabase),
  ]);
  const ch = prof ? chars.find((c) => c.hashed_id === prof.hashed_id) : undefined;
  if (!ch || !ch.in_dream_guild) {
    return NextResponse.json({ error: 'This character is no longer on your account or in a Dream guild' }, { status: 403 });
  }

  try {
    const { profile, notice } = await syncProfile(auth.user.id, id);
    return NextResponse.json({ profile, notice });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Sync failed';
    return NextResponse.json({ error: msg }, { status: msg.startsWith('Synced recently') ? 429 : 502 });
  }
}
