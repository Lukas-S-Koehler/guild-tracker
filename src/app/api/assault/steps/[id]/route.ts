import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, isErrorResponse } from '@/lib/auth-helpers';
import { getStep, updateStep, deleteStep } from '@/lib/assault-service';

export const dynamic = 'force-dynamic';

const EDITABLE_KEYS = [
  'step_key',
  'label',
  'offset_minutes',
  'enabled',
  'mention_roles',
  'message_template',
  'sort_order',
] as const;

async function authAndOwnership(req: NextRequest, stepId: string) {
  const auth = await verifyAuth(req, 'OFFICER');
  if (isErrorResponse(auth)) return { error: auth };
  const existing = await getStep(stepId);
  if (!existing) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) };
  if (existing.guild_id !== auth.guildId) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { auth, existing };
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await authAndOwnership(req, params.id);
  if ('error' in r) return r.error;
  try {
    const body = await req.json();
    const patch: Record<string, unknown> = {};
    for (const key of EDITABLE_KEYS) if (key in body) patch[key] = body[key];
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'No editable fields' }, { status: 400 });
    }
    const step = await updateStep(params.id, patch);
    return NextResponse.json({ step });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await authAndOwnership(req, params.id);
  if ('error' in r) return r.error;
  try {
    await deleteStep(params.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
