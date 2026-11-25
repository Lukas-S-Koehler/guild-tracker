import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { huntingBow } from '@/lib/combat/hunting-gear';
import { validateGear } from '@/lib/combat/gear-save';
import type { GearSelection } from '@/lib/combat/character-stats';
import { publicEligibility } from '@/lib/assault-eligibility';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/assault/eligibility/public { hashed_id, gear?: [...] | null, bow?: string | null }
 * No sign-in: the minimum checklist for any character by hashed id (shared API key, rate-limited).
 * Gear and bow come from the visitor's browser and are never saved.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { hashed_id?: string; gear?: GearSelection[] | null; bow?: string | null };
  const hashedId = String(body.hashed_id ?? '').trim();
  if (!hashedId) return NextResponse.json({ error: 'hashed_id required' }, { status: 400 });
  const supabase = createAdminClient();

  let gear: GearSelection[] | null = null;
  if (Array.isArray(body.gear)) {
    const valid = await validateGear(supabase, body.gear);
    if (!valid.ok) return NextResponse.json({ error: valid.error }, { status: 400 });
    gear = valid.gear;
  }
  if (body.bow && !huntingBow(body.bow)) return NextResponse.json({ error: 'Unknown bow' }, { status: 400 });
  const bow = body.bow ? huntingBow(body.bow)!.name : null;

  const res = await publicEligibility(hashedId, { gear, bow }, supabase);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({ character: res.character, rubrics: res.rubrics });
}
