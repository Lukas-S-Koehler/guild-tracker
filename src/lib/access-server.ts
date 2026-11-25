/**
 * Server side of src/lib/use-access.ts: the same levels for API routes.
 *  - member:    super admin, an approved character claim, or a site role in a guild (requireMember)
 *  - assaulter: super admin, a character on your account in an assault guild (DE / DI), or a role there
 */
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { SUPER_ADMIN_EMAIL } from '@/lib/auth-helpers';
import { isResponse, requireMember } from '@/lib/user-auth';
import { getAccountCharacters } from '@/lib/account-service';
import { ASSAULT_ENTRY_GUILD_ID, ASSAULT_TOP_GUILD_ID } from '@/lib/raids';

const ASSAULT_GUILD_IDS = [ASSAULT_ENTRY_GUILD_ID, ASSAULT_TOP_GUILD_ID];

export async function requireAccess(
  req: Request,
  level: 'member' | 'assaulter'
): Promise<{ id: string; email?: string } | NextResponse> {
  const user = await requireMember(req);
  if (isResponse(user) || level === 'member' || user.email === SUPER_ADMIN_EMAIL) return user;
  const admin = createAdminClient();
  const [chars, { count: roles }] = await Promise.all([
    getAccountCharacters(user.id, admin),
    admin.from('guild_leaders').select('id', { count: 'exact', head: true }).eq('user_id', user.id).in('guild_id', ASSAULT_GUILD_IDS),
  ]);
  const inAssault = chars.some((c) => c.in_dream_guild && !!c.guild_id && ASSAULT_GUILD_IDS.includes(String(c.guild_id)));
  if (!inAssault && !roles) return NextResponse.json({ error: 'For assault guild members only' }, { status: 403 });
  return user;
}
