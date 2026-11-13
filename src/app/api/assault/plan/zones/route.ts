import { NextResponse } from 'next/server';
import { listZones } from '@/lib/assault-plan';

export const dynamic = 'force-dynamic';

export async function GET() {
  const zones = await listZones();
  return NextResponse.json({ zones });
}
