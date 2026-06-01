import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, createAdminClient } from '@/lib/supabase-server';

// GET /api/members/list-all
// Returns all active members across all guilds with guild info
// Any authenticated user can call this
export async function GET(req: NextRequest) {
  const supabase = createServerClient(req);
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();

  const { data, error: membersError } = await admin
    .from('members')
    .select(`
      id,
      idlemmo_id,
      ign,
      position,
      avatar_url,
      total_level,
      guild:guilds!current_guild_id(id, name, nickname)
    `)
    .eq('is_active', true)
    .order('total_level', { ascending: false });

  if (membersError) {
    return NextResponse.json({ error: membersError.message }, { status: 500 });
  }

  return NextResponse.json(data || []);
}
