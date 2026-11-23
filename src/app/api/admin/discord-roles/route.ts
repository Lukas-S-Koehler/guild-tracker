import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { verifySuperAdmin, isErrorResponse } from '@/lib/auth-helpers';
import { AUTO_SYNC_SETTING, applyRoleChanges, planRoleSync, roleNames } from '@/lib/discord-roles';
import { RANKS, loadRankRoles, saveRankRoles } from '@/lib/achievement-ranks';
import { createGuildRole, listGuildRoles } from '@/lib/discord-api';
import { DISCORD_SERVER_ID } from '@/lib/discord-live';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function keepsList(supabase: ReturnType<typeof createAdminClient>, names?: Map<string, string>) {
  const n = names ?? roleNames(await loadRankRoles(supabase));
  const { data } = await supabase.from('discord_role_keeps').select('discord_id, role_id, note, created_at').order('created_at', { ascending: false });
  return (data ?? []).map((k) => ({ ...k, role_name: n.get(k.role_id) ?? k.role_id }));
}

/** Achievement rank ladder + whether each Discord role exists (deleted in Discord = missing). */
async function rankStatus(supabase: ReturnType<typeof createAdminClient>) {
  const saved = await loadRankRoles(supabase);
  const live = await listGuildRoles(DISCORD_SERVER_ID).catch(() => null);
  const byId = new Map((live ?? []).map((r) => [r.id, r]));
  return RANKS.map((r) => {
    const id = saved[r.key] ?? null;
    const role = id ? byId.get(id) : undefined;
    return { key: r.key, name: r.name, min: r.min, emoji: r.emoji, role_id: id, role_name: role?.name ?? null, exists: live ? !!role : null };
  });
}

// GET /api/admin/discord-roles → dry run (what the sync would change), keeps, auto switch. Super admin.
export async function GET(req: NextRequest) {
  const auth = await verifySuperAdmin(req);
  if (isErrorResponse(auth)) return auth;
  const supabase = createAdminClient();
  const nameMap = roleNames(await loadRankRoles(supabase));
  const names = Object.fromEntries(nameMap);
  const [{ data: auto }, keeps, ranks] = await Promise.all([
    supabase.from('app_settings').select('value').eq('key', AUTO_SYNC_SETTING).maybeSingle(),
    keepsList(supabase, nameMap),
    rankStatus(supabase),
  ]);
  try {
    const plan = await planRoleSync(supabase);
    return NextResponse.json({ ok: true, plan, keeps, names, ranks, auto: auto?.value === 'true' });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err instanceof Error ? err.message : err), keeps, names, ranks, auto: auto?.value === 'true' });
  }
}

// POST { action: 'create-ranks' } | { action: 'apply' } | { action: 'apply-user', discord_id } | { action: 'keep'|'unkeep', discord_id, role_id, note? } | { action: 'auto', value }
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
      if (!body.discord_id || !roleNames(await loadRankRoles(supabase)).has(body.role_id)) return NextResponse.json({ error: 'discord_id and a managed role_id required' }, { status: 400 });
      const q = body.action === 'keep'
        ? supabase.from('discord_role_keeps').upsert({ discord_id: body.discord_id, role_id: body.role_id, note: body.note ?? null })
        : supabase.from('discord_role_keeps').delete().eq('discord_id', body.discord_id).eq('role_id', body.role_id);
      const { error } = await q;
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true, keeps: await keepsList(supabase) });
    }
    case 'create-ranks': {
      // Create the rank roles that are missing (never saved, or deleted in Discord). Existing ones are left alone,
      // so renaming / recolouring / moving them in Discord is safe.
      const saved = await loadRankRoles(supabase);
      const live = new Set((await listGuildRoles(DISCORD_SERVER_ID)).map((r) => r.id));
      const created: string[] = [];
      // Highest rank first: each new role lands at the bottom, so the ladder ends up in order (Dreamer lowest).
      for (const r of [...RANKS].reverse()) {
        if (saved[r.key] && live.has(saved[r.key])) continue;
        const role = await createGuildRole(DISCORD_SERVER_ID, { name: r.name, color: r.color }, 'Dream Hub achievement rank');
        saved[r.key] = role.id;
        created.push(r.name);
        await saveRankRoles(supabase, saved); // save as we go, so a failure halfway never orphans a role
      }
      return NextResponse.json({ ok: true, created, ranks: await rankStatus(supabase) });
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
