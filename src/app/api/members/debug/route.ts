import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { verifyAuth, isErrorResponse } from '@/lib/auth-helpers';

export async function GET(req: NextRequest) {
  // Verify authentication and get guild context
  const authResult = await verifyAuth(req);
  if (isErrorResponse(authResult)) return authResult;
  const { guildId } = authResult;

  const supabase = createServerClient(req);

  const { data, error } = await supabase
    .from('members')
    .select('*')
    .eq('guild_id', guildId);

  console.log("DEBUG MEMBERS:", data, error);

  return NextResponse.json({ data, error });
}
