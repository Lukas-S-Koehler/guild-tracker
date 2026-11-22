import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

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
