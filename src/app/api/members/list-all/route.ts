import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';

// GET /api/members/list-all — public, no auth required
export async function GET(req: NextRequest) {
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
