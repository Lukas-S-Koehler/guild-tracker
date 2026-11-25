import { requireAccess } from '@/lib/access-server';
import { isResponse } from '@/lib/user-auth';
import { NextResponse } from 'next/server';
import { listPotions } from '@/lib/potions-service';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const gate = await requireAccess(req, 'assaulter');
  if (isResponse(gate)) return gate;
  const data = await listPotions();
  return NextResponse.json(data);
}
