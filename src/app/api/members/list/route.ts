// app/api/members/list/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { verifyAuthOrPublic, isErrorResponse } from '@/lib/auth-helpers';

// GET /api/members/list — public, no auth required
export async function GET(req: NextRequest) {
  const authResult = await verifyAuthOrPublic(req);
  if (isErrorResponse(authResult)) return authResult;
  const { guildId } = authResult;

  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('members')
    .select(`
      *,
      guild:guilds!current_guild_id (
        id,
        name,
        nickname
      )
    `)
    .eq('current_guild_id', guildId)
    .eq('is_active', true)
    .order('position', { ascending: true })
    .order('total_level', { ascending: false });

  if (error) {
    console.error('LIST MEMBERS ERROR:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
