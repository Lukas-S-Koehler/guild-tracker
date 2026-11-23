import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { verifySuperAdmin, isErrorResponse } from '@/lib/auth-helpers';
import { AUTO_SYNC_SETTING, MANAGED_ROLES, applyRoleChanges, planRoleSync, roleName } from '@/lib/discord-roles';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function keepsList(supabase: ReturnType<typeof createAdminClient>) {
  const { data } = await supabase.from('discord_role_keeps').select('discord_id, role_id, note, created_at').order('created_at', { ascending: false });
  return (data ?? []).map((k) => ({ ...k, role_name: roleName(k.role_id) }));
}

// GET /api/admin/discord-roles → dry run (what the sync would change), keeps, auto switch. Super admin.
export async function GET(req: NextRequest) {
  const auth = await verifySuperAdmin(req);
  if (isErrorResponse(auth)) return auth;
  const supabase = createAdminClient();
  const names = Object.fromEntries(Array.from(MANAGED_ROLES).map((id) => [id, roleName(id)]));
  const [{ data: auto }, keeps] = await Promise.all([
    supabase.from('app_settings').select('value').eq('key', AUTO_SYNC_SETTING).maybeSingle(),
    keepsList(supabase),
  ]);
  try {
    const plan = await planRoleSync(supabase);
    return NextResponse.json({ ok: true, plan, keeps, names, auto: auto?.value === 'true' });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err instanceof Error ? err.message : err), keeps, names, auto: auto?.value === 'true' });
  }
}

// POST { action: 'apply' } | { action: 'apply-user', discord_id } | { action: 'keep'|'unkeep', discord_id, role_id, note? } | { action: 'auto', value }
export async function POST(req: NextRequest) {
  const auth = await verifySuperAdmin(req);
  if (isErrorResponse(auth)) return auth;
  const supabase = createAdminClient();
  const body = await req.json().catch(() => ({}));

  switch (body.action) {
    case 'apply':
    case 'apply-user': {
      // Always re-plan server side; the client list may be stale.
      const plan = await planRoleSync(supabase);
      const changes = body.action === 'apply' ? plan.changes : plan.changes.filter((c) => c.discord_id === body.discord_id);
      return NextResponse.json({ ok: true, users: changes.length, ...(await applyRoleChanges(changes)) });
    }
    case 'keep':
    case 'unkeep': {
      if (!body.discord_id || !MANAGED_ROLES.has(body.role_id)) return NextResponse.json({ error: 'discord_id and a managed role_id required' }, { status: 400 });
      const q = body.action === 'keep'
        ? supabase.from('discord_role_keeps').upsert({ discord_id: body.discord_id, role_id: body.role_id, note: body.note ?? null })
        : supabase.from('discord_role_keeps').delete().eq('discord_id', body.discord_id).eq('role_id', body.role_id);
      const { error } = await q;
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true, keeps: await keepsList(supabase) });
    }
    case 'auto': {
      const { error } = await supabase.from('app_settings').upsert({ key: AUTO_SYNC_SETTING, value: String(!!body.value) });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true, auto: !!body.value });
    }
    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }
}
