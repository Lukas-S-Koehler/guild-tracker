import { NextResponse } from 'next/server';
import { listLocationPlans } from '@/lib/assault-plan';

export const dynamic = 'force-dynamic';

// Public: conquest locations (ids 1-10) with enemies, drops and market-based gold/hour.
export async function GET() {
  try {
    const locations = await listLocationPlans();
    return NextResponse.json({ locations });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
