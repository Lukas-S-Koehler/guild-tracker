import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { verifyAdminOrLeader, isErrorResponse } from '@/lib/auth-helpers';

/**
 * PATCH /api/admin/guild-meta
 * Update guild metadata (min_level).
 * Super admin: any guild. Guild leader: own guild only.
 */
export async function PATCH(req: NextRequest) {
  const auth = await verifyAdminOrLeader(req);
  if (isErrorResponse(auth)) return auth;

  const supabase = createServerClient(req);

  try {
    const body = await req.json();
    const { guild_id, min_level } = body;

    if (!guild_id) {
      return NextResponse.json({ error: 'guild_id is required' }, { status: 400 });
    }

    if (!auth.isSuperAdmin && guild_id !== auth.guildId) {
      return NextResponse.json({ error: 'Forbidden - You can only manage your own guild' }, { status: 403 });
    }

    const updateData: Record<string, any> = {};
    if (min_level !== undefined) updateData.min_level = Number(min_level);

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    const { error } = await supabase
      .from('guilds')
      .update(updateData)
      .eq('id', guild_id);

    if (error) {
      console.error('[Admin] Error updating guild meta:', error);
      return NextResponse.json({ error: 'Failed to update guild' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Admin] Error:', error);
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}
