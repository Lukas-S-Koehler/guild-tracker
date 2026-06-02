import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, createAdminClient } from '@/lib/supabase-server';
import { SUPER_ADMIN_EMAIL } from '@/lib/auth-helpers';

const OFFICER_ROLES = new Set(['OFFICER', 'DEPUTY', 'LEADER']);

/**
 * GET /api/discord/guild-stats
 * Returns per-guild discord mapping counts (total/mapped) for all guilds.
 * Accessible to any officer+ in at least one guild. No individual discord IDs returned.
 */
export async function GET(req: NextRequest) {
  const supabase = createServerClient(req);
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const isSuperAdmin = user.email === SUPER_ADMIN_EMAIL;

  if (!isSuperAdmin) {
    const { data: memberships } = await supabase
      .from('guild_leaders')
      .select('role')
      .eq('user_id', user.id);

    const hasOfficerRole = memberships?.some(m => OFFICER_ROLES.has(m.role));
    if (!hasOfficerRole) {
      return NextResponse.json({ error: 'Forbidden - Officer+ required' }, { status: 403 });
    }
  }

  const adminClient = createAdminClient();

  const { data: guilds, error: guildsErr } = await adminClient
    .from('guilds')
    .select('id, name, nickname')
    .order('display_order', { ascending: true });

  if (guildsErr || !guilds) {
    return NextResponse.json({ error: 'Failed to fetch guilds' }, { status: 500 });
  }

  const { data: members, error: membersErr } = await adminClient
    .from('members')
    .select('current_guild_id, discord_id')
    .eq('is_active', true);

  if (membersErr) {
    return NextResponse.json({ error: 'Failed to fetch members' }, { status: 500 });
  }

  const totalMap = new Map<string, number>();
  const mappedMap = new Map<string, number>();

  for (const m of members ?? []) {
    totalMap.set(m.current_guild_id, (totalMap.get(m.current_guild_id) ?? 0) + 1);
    if (m.discord_id) {
      mappedMap.set(m.current_guild_id, (mappedMap.get(m.current_guild_id) ?? 0) + 1);
    }
  }

  const stats = guilds.map(g => ({
    guild_id: g.id,
    guild_name: g.nickname || g.name,
    total: totalMap.get(g.id) ?? 0,
    mapped: mappedMap.get(g.id) ?? 0,
  }));

  return NextResponse.json(stats);
}
