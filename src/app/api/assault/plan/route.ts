import { NextRequest, NextResponse } from 'next/server';
import { getZonePlan, shrineInfoFor } from '@/lib/assault-plan';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const zone = searchParams.get('zone');
  if (!zone) return NextResponse.json({ error: 'zone query param required' }, { status: 400 });

  const plan = await getZonePlan(zone);
  return NextResponse.json({ ...plan, shrine_info: shrineInfoFor(plan.zone) });
}
