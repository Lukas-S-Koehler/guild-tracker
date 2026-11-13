import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, isErrorResponse } from '@/lib/auth-helpers';
import { listSteps, createStep } from '@/lib/assault-service';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req, 'OFFICER');
  if (isErrorResponse(auth)) return auth;
  try {
    const steps = await listSteps(auth.guildId);
    return NextResponse.json({ steps });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req, 'OFFICER');
  if (isErrorResponse(auth)) return auth;
  try {
    const body = await req.json();
    const {
      step_key,
      label,
      offset_minutes,
      enabled = true,
      mention_roles = [],
      message_template,
      sort_order,
    } = body;
    if (!step_key || !label || typeof offset_minutes !== 'number' || !message_template) {
      return NextResponse.json(
        { error: 'step_key, label, offset_minutes, message_template required' },
        { status: 400 }
      );
    }
    const step = await createStep(auth.guildId, {
      step_key,
      label,
      offset_minutes,
      enabled,
      mention_roles,
      message_template,
      sort_order: sort_order ?? 999,
    });
    return NextResponse.json({ step });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
