import { requireAccess } from '@/lib/access-server';
import { isResponse } from '@/lib/user-auth';
import { NextResponse } from 'next/server';
import { listLocationPlans } from '@/lib/assault-plan';

export const dynamic = 'force-dynamic';

// Public: conquest locations (ids 1-10) with enemies, drops and market-based gold/hour.
export async function GET(req: Request) {
  const gate = await requireAccess(req, 'member');
  if (isResponse(gate)) return gate;
  try {
    const locations = await listLocationPlans();
    return NextResponse.json({ locations });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
