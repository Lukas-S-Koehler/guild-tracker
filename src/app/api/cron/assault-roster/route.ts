import { NextRequest, NextResponse } from 'next/server';
import { syncAssaultRoster } from '@/lib/assault-roster-sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function verifyCronSecret(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

/**
 * POST /api/cron/assault-roster — refresh Assault Roster snapshots (stalest first, ~240 s budget).
 * The workflow calls it again while `remaining` > 0 (API keys allow ~20 requests/minute).
 */
export async function POST(req: NextRequest) {
  if (!verifyCronSecret(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const result = await syncAssaultRoster();
  return NextResponse.json(result);
}
