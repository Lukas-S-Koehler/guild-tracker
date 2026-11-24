import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase-server';
import { classifyNearby } from '@/lib/recruit-service';
import { parseNearby } from '@/lib/recruit-parse';

export const dynamic = 'force-dynamic';

/** Triage a pasted "Nearby Characters" list. Body: { text } */
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req, 'DEPUTY');
  if (auth instanceof NextResponse) return auth;
  const body = (await req.json().catch(() => null)) as { text?: string } | null;
  const text = (body?.text ?? '').slice(0, 50_000);
  const chars = parseNearby(text);
  if (!chars.length) return NextResponse.json({ error: 'No characters found in the pasted text' }, { status: 400 });
  try {
    return NextResponse.json({ rows: await classifyNearby(createAdminClient(), chars) });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
