import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { verifyAuth, isErrorResponse } from '@/lib/auth-helpers';

/**
 * PATCH /api/challenges/edit
 * Edit a specific challenge entry
 */
export async function PATCH(req: NextRequest) {
  // Verify authentication (officers and leaders can edit)
  const auth = await verifyAuth(req, 'OFFICER');
  if (isErrorResponse(auth)) return auth;

  const { guildId } = auth;
  const supabase = createServerClient(req);
  const body = await req.json();
  const { challenge_id, raw_input, total_cost } = body as {
    challenge_id: string;
    raw_input?: string;
    total_cost?: number;
  };

  if (!challenge_id) {
    return NextResponse.json({ error: 'challenge_id is required' }, { status: 400 });
  }

  console.log(`[Edit Challenge] Editing challenge ${challenge_id}`);

  // Build update object
  const updates: Record<string, any> = {
    updated_at: new Date().toISOString(),
  };

  if (raw_input !== undefined) updates.raw_input = raw_input;
  if (total_cost !== undefined) updates.total_cost = total_cost;

  // Update the challenge
  const { error } = await supabase
    .from('challenges')
    .update(updates)
    .eq('id', challenge_id)
    .eq('guild_id', guildId);

  if (error) {
    console.error('[Edit Challenge] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  console.log(`✅ Updated challenge ${challenge_id}`);
  return NextResponse.json({ success: true });
}
