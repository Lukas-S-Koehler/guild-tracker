import { NextRequest, NextResponse } from 'next/server';
import { syncAssaultRoster } from '@/lib/assault-roster-sync';
import { syncAllEligibility } from '@/lib/assault-eligibility';

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
 * Once the rosters are done, the rest of the budget snapshots claimed characters outside the
 * assault guilds for /assault/eligibility and the staff scouting list (`eligibility.remaining`).
 */
export async function POST(req: NextRequest) {
  if (!verifyCronSecret(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const started = Date.now();
  const result = await syncAssaultRoster();
  const left = 240_000 - (Date.now() - started);
  if (result.remaining > 0 || left < 90_000) return NextResponse.json({ ...result, eligibility: null });
  const eligibility = await syncAllEligibility(left - 75_000).catch((e) => ({ error: String(e), remaining: 0 }));
  // The workflow loops on `remaining`: keep going while eligibility snapshots are still due.
  return NextResponse.json({ ...result, remaining: eligibility.remaining ?? 0, eligibility });
}
