import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase-server';
import { huntingBow } from '@/lib/combat/hunting-gear';
import { validateGear } from '@/lib/combat/gear-save';
import type { GearSelection } from '@/lib/combat/character-stats';
import { recruiterCheck } from '@/lib/assault-eligibility';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/admin/recruit/check { hashed_id, bow?, gear? } — deputies and up, like Recruiting.
 * Assault minimum checklist for any character by hashed id, plus the cheapest gear set that gets
 * Battle to Bronze. `gear` = the recruiter's own pick instead of that set. Nothing is saved.
 */
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req, 'DEPUTY');
  if (auth instanceof NextResponse) return auth;
  const body = (await req.json().catch(() => ({}))) as { hashed_id?: string; bow?: string | null; gear?: GearSelection[] | null };
  const hashedId = String(body.hashed_id ?? '').trim();
  if (!hashedId) return NextResponse.json({ error: 'hashed_id required' }, { status: 400 });
  const supabase = createAdminClient();
  if (body.bow && !huntingBow(body.bow)) return NextResponse.json({ error: 'Unknown bow' }, { status: 400 });
  let gear: GearSelection[] | null = null;
  if (Array.isArray(body.gear)) {
    const valid = await validateGear(supabase, body.gear);
    if (!valid.ok) return NextResponse.json({ error: valid.error }, { status: 400 });
    gear = valid.gear;
  }
  const res = await recruiterCheck(hashedId, { bow: body.bow ? huntingBow(body.bow)!.name : null, gear }, supabase);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({ character: res.character, rubrics: res.rubrics, minGear: res.minGear, usingMinGear: res.usingMinGear });
}
