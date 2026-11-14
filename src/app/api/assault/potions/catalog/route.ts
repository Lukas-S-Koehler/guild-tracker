import { NextResponse } from 'next/server';
import { listPotions } from '@/lib/potions-service';

export const dynamic = 'force-dynamic';

export async function GET() {
  const data = await listPotions();
  return NextResponse.json(data);
}
