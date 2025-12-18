import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { verifyAuth, isErrorResponse } from '@/lib/auth-helpers';

/**
 * DELETE /api/challenges/delete
 * Delete challenges by dates
 */
export async function POST(req: NextRequest) {
  // Verify authentication (officers and leaders can delete)
  const auth = await verifyAuth(req, 'OFFICER');
  if (isErrorResponse(auth)) return auth;

  const { guildId } = auth;
  const supabase = createServerClient(req);
  const body = await req.json();
  const { dates } = body as { dates: string[] };

  if (!dates || dates.length === 0) {
    return NextResponse.json({ error: 'No dates provided' }, { status: 400 });
  }

  console.log(`[Delete Challenges] Deleting challenges for dates:`, dates);

  // Delete challenges for these dates in this guild
  const { error } = await supabase
    .from('challenges')
    .delete()
    .eq('guild_id', guildId)
    .in('challenge_date', dates);

  if (error) {
    console.error('[Delete Challenges] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  console.log(`✅ Deleted challenges for ${dates.length} date(s)`);
  return NextResponse.json({ success: true, deleted: dates.length });
}
