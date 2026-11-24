import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase-server';
import { listProspects, setStatus, updateNote, deleteProspect, staffName } from '@/lib/recruit-service';
import type { RecruitLanguage, RecruitStatus } from '@/lib/recruit-parse';

export const dynamic = 'force-dynamic';

const STATUSES: RecruitStatus[] = ['messaged', 'replied', 'joined', 'declined', 'skip_guild', 'skip_weak'];

/** Recruit tracker: shared across Dream guilds, deputies and up. */
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req, 'DEPUTY');
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json(await listProspects(createAdminClient()));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/** Set a player's status (creates them if new). Body: { ign, status, location?, language?, note? } */
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req, 'DEPUTY');
  if (auth instanceof NextResponse) return auth;
  const body = (await req.json().catch(() => null)) as {
    ign?: string; status?: RecruitStatus; location?: string | null; language?: RecruitLanguage | null; note?: string | null;
  } | null;
  const ign = body?.ign?.trim();
  if (!ign || !/^[A-Za-z0-9_]{2,30}$/.test(ign)) return NextResponse.json({ error: 'Valid ign required' }, { status: 400 });
  if (!body?.status || !STATUSES.includes(body.status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  if (body.language != null && body.language !== 'en' && body.language !== 'de') {
    return NextResponse.json({ error: 'Invalid language' }, { status: 400 });
  }
  const supabase = createAdminClient();
  try {
    const actor = { id: auth.user.id, name: await staffName(supabase, auth.user.id, auth.guildId) };
    const prospect = await setStatus(supabase, {
      ign, status: body.status,
      location: body.location === undefined ? undefined : body.location?.slice(0, 80) ?? null,
      language: body.language,
      note: body.note === undefined ? undefined : body.note?.slice(0, 500) ?? null,
    }, actor);
    return NextResponse.json({ prospect });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/** Edit a note. Body: { id, note } */
export async function PATCH(req: NextRequest) {
  const auth = await verifyAuth(req, 'DEPUTY');
  if (auth instanceof NextResponse) return auth;
  const body = (await req.json().catch(() => null)) as { id?: string; note?: string | null } | null;
  if (!body?.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const supabase = createAdminClient();
  try {
    const actor = { id: auth.user.id, name: await staffName(supabase, auth.user.id, auth.guildId) };
    await updateNote(supabase, body.id, body.note?.slice(0, 500) ?? null, actor);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/** Remove a player from the list (mistakes). ?id= */
export async function DELETE(req: NextRequest) {
  const auth = await verifyAuth(req, 'DEPUTY');
  if (auth instanceof NextResponse) return auth;
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  try {
    await deleteProspect(createAdminClient(), id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
