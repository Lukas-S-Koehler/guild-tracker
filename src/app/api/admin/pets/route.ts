import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { verifySuperAdmin, isErrorResponse } from '@/lib/auth-helpers';
import { PET_QUALITIES, parsePetStatsPaste, type CustomPet } from '@/lib/combat/custom-pets';
import { ensureCustomPets } from '@/lib/combat/custom-pets-server';
import { PET_STATS, PET_EXTRA } from '@/lib/combat/pet-data';
import { petHuntEstimate, huntEstimateFromStats, PET_HUNT_STATS } from '@/lib/combat/pet-hunting';

export const dynamic = 'force-dynamic';

/** GET /api/admin/pets — admin-added pets with their Lv 100 Citadel hunting estimate. */
export async function GET(req: NextRequest) {
  const auth = await verifySuperAdmin(req);
  if (isErrorResponse(auth)) return auth;
  const pets = await ensureCustomPets(true);
  return NextResponse.json({
    pets: pets.map((p) => ({ ...p, hunt: petHuntEstimate(p.name, 100, 100, 0) })),
  });
}

/**
 * POST /api/admin/pets { name, quality, paste, preview? }
 * Parses the in-game stats paste. preview=true only parses (nothing saved).
 */
export async function POST(req: NextRequest) {
  const auth = await verifySuperAdmin(req);
  if (isErrorResponse(auth)) return auth;
  const body = (await req.json().catch(() => ({}))) as { name?: string; quality?: string; paste?: string; preview?: boolean };
  const name = (body.name ?? '').trim();
  if (!/^[A-Za-z][A-Za-z' -]{1,30}$/.test(name)) return NextResponse.json({ error: 'Pet name: letters only, 2–31 characters' }, { status: 400 });
  if (!PET_QUALITIES.includes(body.quality as (typeof PET_QUALITIES)[number])) {
    return NextResponse.json({ error: 'Pick a quality' }, { status: 400 });
  }
  const existing = PET_STATS[name] as { custom?: boolean } | undefined;
  if (existing && !existing.custom) return NextResponse.json({ error: `${name} is already built in` }, { status: 409 });

  const { stats, missing } = parsePetStatsPaste(body.paste ?? '');
  if (!stats) return NextResponse.json({ error: `Could not read: ${missing.join(', ')}` }, { status: 400 });
  const pet: CustomPet = { name, quality: body.quality as CustomPet['quality'], stats };

  if (body.preview) {
    return NextResponse.json({ pet, hunt: huntEstimateFromStats(name, pet.quality === 'Event' ? 'Epic' : pet.quality, stats, 100, 100, 0) });
  }

  const { error } = await createAdminClient()
    .from('custom_pets')
    .upsert({ name, quality: pet.quality, stats, created_by: auth.user.id }, { onConflict: 'name' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await ensureCustomPets(true);
  return NextResponse.json({ pet, hunt: petHuntEstimate(name, 100, 100, 0) });
}

/** DELETE /api/admin/pets?name=X */
export async function DELETE(req: NextRequest) {
  const auth = await verifySuperAdmin(req);
  if (isErrorResponse(auth)) return auth;
  const name = req.nextUrl.searchParams.get('name') ?? '';
  const { error } = await createAdminClient().from('custom_pets').delete().eq('name', name);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if ((PET_STATS[name] as { custom?: boolean } | undefined)?.custom) {
    delete PET_STATS[name];
    delete PET_EXTRA[name];
    delete PET_HUNT_STATS[name];
  }
  await ensureCustomPets(true);
  return NextResponse.json({ ok: true });
}
