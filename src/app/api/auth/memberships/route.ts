import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, createAdminClient } from '@/lib/supabase-server';

// GET /api/auth/memberships — returns guild memberships for the authenticated user
export async function GET(req: NextRequest) {
  const supabase = createServerClient(req);
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json([], { status: 200 });
  }

  const admin = createAdminClient();

  const { data: memberships, error: membershipsError } = await admin
    .from('guild_leaders')
    .select('guild_id, role, joined_at')
    .eq('user_id', user.id)
    .order('joined_at', { ascending: true });

  if (membershipsError || !memberships || memberships.length === 0) {
    return NextResponse.json([], { status: 200 });
  }

  const guildIds = memberships.map(m => m.guild_id);
  const { data: guildsData } = await admin
    .from('guilds')
    .select('id, name, nickname, is_active')
    .in('id', guildIds);

  const guildMap = new Map((guildsData ?? []).map(g => [g.id, g]));

  const result = memberships.map(m => ({
    guild_id: m.guild_id,
    guild_name: guildMap.get(m.guild_id)?.nickname || guildMap.get(m.guild_id)?.name || 'Unknown Guild',
    role: m.role as 'MEMBER' | 'OFFICER' | 'DEPUTY' | 'LEADER',
    joined_at: m.joined_at,
    is_active: guildMap.get(m.guild_id)?.is_active ?? true,
  }));

  return NextResponse.json(result);
}
