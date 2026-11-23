import { NextResponse } from 'next/server';
import { createAdminClient, createServerClient } from '@/lib/supabase-server';
import { SUPER_ADMIN_EMAIL } from '@/lib/auth-helpers';

/** Signed-in user, no guild requirement. */
export async function requireUser(req: Request): Promise<{ id: string; email?: string } | NextResponse> {
  const supabase = createServerClient(req);
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized - Please sign in' }, { status: 401 });
  return { id: user.id, email: user.email };
}

export const isResponse = (v: unknown): v is NextResponse => v instanceof NextResponse;

/** Display name without exposing email (same fallback as find_user_by_username). */
export function displayNameOf(u: { email?: string | null; user_metadata?: Record<string, unknown> } | null): string {
  if (!u) return 'Unknown user';
  const meta = u.user_metadata?.display_name;
  if (typeof meta === 'string' && meta.trim()) return meta;
  return (u.email ?? '').split('@')[0] || 'Unknown user';
}

/**
 * Signed-in Dream member: super admin, an approved character claim, or any site role in a guild.
 * Used by members-only pages such as profiles (/p/[ign]).
 */
export async function requireMember(req: Request): Promise<{ id: string; email?: string } | NextResponse> {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  if (user.email === SUPER_ADMIN_EMAIL) return user;
  const admin = createAdminClient();
  const [{ count: claims }, { count: roles }] = await Promise.all([
    admin.from('user_characters').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('status', 'approved'),
    admin.from('guild_leaders').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
  ]);
  if (!claims && !roles) return NextResponse.json({ error: 'Members only: claim your character first' }, { status: 403 });
  return user;
}
