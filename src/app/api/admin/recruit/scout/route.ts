import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase-server';
import { scoutingList } from '@/lib/assault-eligibility';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/recruit/scout — claimed characters outside the assault guilds that meet an assault
 * guild's minimum (stored verdicts), interested ones first. Deputies and up, like Recruiting.
 */
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req, 'DEPUTY');
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json(await scoutingList(createAdminClient()));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
