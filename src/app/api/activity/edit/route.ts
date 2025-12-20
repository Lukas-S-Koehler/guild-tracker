import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { verifyAuth, isErrorResponse } from '@/lib/auth-helpers';

/**
 * PATCH /api/activity/edit
 * Edit a specific daily_log entry
 */
export async function PATCH(req: NextRequest) {
  // Verify authentication (officers and leaders can edit)
  const auth = await verifyAuth(req, 'OFFICER');
  if (isErrorResponse(auth)) return auth;

  const { guildId } = auth;
  const supabase = createServerClient(req);
  const body = await req.json();
  const { log_id, raids, gold_donated } = body as {
    log_id: string;
    raids?: number;
    gold_donated?: number;
  };

  if (!log_id) {
    return NextResponse.json({ error: 'log_id is required' }, { status: 400 });
  }

  console.log(`[Edit Activity] Editing log ${log_id}`);

  // Build update object
  const updates: Record<string, any> = {
    updated_at: new Date().toISOString(),
  };

  if (raids !== undefined) updates.raids = raids;
  if (gold_donated !== undefined) updates.gold_donated = gold_donated;

  // Recalculate met_requirement if gold_donated was updated
  // NOTE: We can only check gold-based requirement here because individual
  // donation items aren't stored in the database. The quantity-based check
  // (50% of any challenge item) is only available during initial save.
  if (gold_donated !== undefined) {
    // Get config for donation requirement
    const { data: config } = await supabase
      .from('guild_config')
      .select('settings')
      .eq('guild_id', guildId)
      .single();

    const donationReq = config?.settings?.donation_requirement || 5000;

    // Simple gold-based check
    // Officers editing manually can see met_requirement and adjust as needed
    updates.met_requirement = gold_donated >= donationReq;
  }

  // Update the log
  const { error } = await supabase
    .from('daily_logs')
    .update(updates)
    .eq('id', log_id)
    .eq('guild_id', guildId);

  if (error) {
    console.error('[Edit Activity] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  console.log(`✅ Updated activity log ${log_id}`);
  return NextResponse.json({ success: true });
}
