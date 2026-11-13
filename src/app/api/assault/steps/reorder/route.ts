import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, isErrorResponse } from '@/lib/auth-helpers';
import { reorderSteps } from '@/lib/assault-service';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req, 'OFFICER');
  if (isErrorResponse(auth)) return auth;
  try {
    const { order } = await req.json();
    if (!Array.isArray(order)) {
      return NextResponse.json({ error: 'order must be array of step ids' }, { status: 400 });
    }
    await reorderSteps(auth.guildId, order);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
