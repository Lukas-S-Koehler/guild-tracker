import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { verifySuperAdmin, isErrorResponse } from '@/lib/auth-helpers';
import { getAccountCharacters, recomputeUserGuildAccess } from '@/lib/account-service';
import { displayNameOf } from '@/lib/user-auth';

export const dynamic = 'force-dynamic';

const ROLES = ['MEMBER', 'OFFICER', 'DEPUTY', 'LEADER'];

/**
 * GET /api/admin/guild-access — every website user with guild access or a claim:
 * their guild_leaders rows (manual / derived) and the characters on their account.
 * Super admin only.
 */
export async function GET(req: NextRequest) {
  const auth = await verifySuperAdmin(req);
  if (isErrorResponse(auth)) return auth;

  const supabase = createAdminClient();
  const [{ data: rows, error }, { data: claims }, { data: guilds }] = await Promise.all([
    supabase.from('guild_leaders').select('id, guild_id, user_id, role, source, joined_at'),
    supabase.from('user_characters').select('user_id').eq('status', 'approved'),
    supabase.from('guilds').select('id, name, nickname'),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const gName = new Map((guilds ?? []).map((g) => [g.id as string, (g.nickname || g.name) as string]));
  const userIds = Array.from(new Set([...(rows ?? []).map((r) => r.user_id), ...(claims ?? []).map((c) => c.user_id)])) as string[];

  const users = await Promise.all(
    userIds.map(async (id) => {
      const [{ data: u }, chars] = await Promise.all([supabase.auth.admin.getUserById(id), getAccountCharacters(id, supabase)]);
      return {
        user_id: id,
        user_name: displayNameOf(u?.user ?? null),
        characters: chars.map((c) => ({
          ign: c.ign,
          guild: c.guild_nickname,
          position: c.position,
          in_dream_guild: c.in_dream_guild,
          claimed: c.claimed,
        })),
        access: (rows ?? [])
          .filter((r) => r.user_id === id)
          .map((r) => ({ id: r.id, guild_id: r.guild_id, guild_name: gName.get(r.guild_id) ?? r.guild_id, role: r.role, source: r.source ?? 'manual' })),
      };
    })
  );
  users.sort((a, b) => a.user_name.localeCompare(b.user_name));
  return NextResponse.json({ users });
}

/**
 * PATCH /api/admin/guild-access { id, role? , source? }
 *  role   → sets a manual override with that role
 *  source='derived' → hand the row back to the game sync (recomputed now; may be
 *                     updated or removed if no character of theirs is in that guild)
 */
export async function PATCH(req: NextRequest) {
  const auth = await verifySuperAdmin(req);
  if (isErrorResponse(auth)) return auth;

  const { id, role, source } = await req.json().catch(() => ({}));
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const supabase = createAdminClient();
  const { data: row } = await supabase.from('guild_leaders').select('id, user_id').eq('id', id).maybeSingle();
  if (!row) return NextResponse.json({ error: 'Row not found' }, { status: 404 });

  if (source === 'derived') {
    await supabase.from('guild_leaders').update({ source: 'derived' }).eq('id', id);
    const access = await recomputeUserGuildAccess(row.user_id, supabase);
    return NextResponse.json({ ok: true, access });
  }
  if (role && ROLES.includes(role)) {
    const { error } = await supabase.from('guild_leaders').update({ role, source: 'manual' }).eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: 'role or source required' }, { status: 400 });
}

/** DELETE /api/admin/guild-access?id= — remove a row (derived rows come back on next sync if still valid). */
export async function DELETE(req: NextRequest) {
  const auth = await verifySuperAdmin(req);
  if (isErrorResponse(auth)) return auth;

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const supabase = createAdminClient();
  const { error } = await supabase.from('guild_leaders').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
