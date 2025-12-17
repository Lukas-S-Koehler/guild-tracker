// app/api/members/list/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { verifyAuth, isErrorResponse } from '@/lib/auth-helpers';

export async function GET(req: NextRequest) {
  // Verify authentication and get guild context
  const authResult = await verifyAuth(req);
  if (isErrorResponse(authResult)) return authResult;
  const { guildId } = authResult;

  const supabase = createServerClient(req);

  // Get members with guild information
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
    .order('position', { ascending: true })
    .order('total_level', { ascending: false });

  if (error) {
    console.error('LIST MEMBERS ERROR:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
