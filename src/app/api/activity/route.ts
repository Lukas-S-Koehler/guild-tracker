import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { verifyAuth, isErrorResponse } from '@/lib/auth-helpers';
import type { ProcessedMember } from '@/types';

export async function GET(req: NextRequest) {
  // Verify authentication (members can view)
  const auth = await verifyAuth(req, 'MEMBER');
  if (isErrorResponse(auth)) return auth;

  const supabase = createServerClient();
  const { searchParams } = new URL(req.url);

  const date = searchParams.get('date');

  // Note: RLS policies will automatically filter by guild
  let query = supabase
    .from('daily_logs')
    .select(`
      *,
      members (id, ign)
    `)
    .order('gold_donated', { ascending: false });

  if (date) {
    query = query.eq('log_date', date);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data || []);
}

export async function POST(req: NextRequest) {
  // Verify authentication (officers and leaders can save activity logs)
  const auth = await verifyAuth(req, 'OFFICER');
  if (isErrorResponse(auth)) return auth;

  const supabase = createServerClient();
  const body = await req.json();

  const { log_date, members } = body as { log_date: string; members: ProcessedMember[] };

  if (!log_date || !members || members.length === 0) {
    return NextResponse.json({ error: 'Date and members are required' }, { status: 400 });
  }

  // Get config for donation requirement using the authenticated guild
  const { data: config } = await supabase
    .from('guild_config')
    .select('settings, guild_id')
    .eq('guild_id', auth.guildId)
    .single();

  // Your schema stores donation_requirement in settings JSONB
  const donationReq = config?.settings?.donation_requirement || 5000;
  const guildId = config?.guild_id;

  // Get challenge for this date and the previous day (challenges can overlap)
  const prevDate = new Date(log_date);
  prevDate.setDate(prevDate.getDate() - 1);
  const prevDateStr = prevDate.toISOString().split('T')[0];

  let challengeTotalCost = 0;

  if (guildId) {
    const { data: challenges } = await supabase
      .from('challenges')
      .select('total_cost, challenge_date')
      .eq('guild_id', guildId)
      .in('challenge_date', [log_date, prevDateStr])
      .order('challenge_date', { ascending: false })
      .limit(1);

    if (challenges && challenges.length > 0) {
      challengeTotalCost = challenges[0].total_cost || 0;
    }
  }

  // Calculate 50% of challenge requirement
  const halfChallengeReq = Math.floor(challengeTotalCost / 2);

  let saved = 0;

  for (const member of members) {
    // Try to find existing member by IGN first
    const { data: existingMember } = await supabase
      .from('members')
      .select('*')
      .eq('ign', member.ign)
      .single();

    let memberData;

    if (existingMember) {
      // Update existing member
      const { data: updated, error: updateError } = await supabase
        .from('members')
        .update({ last_seen: log_date })
        .eq('id', existingMember.id)
        .select()
        .single();

      if (updateError) {
        console.error(`Failed to update member ${member.ign}:`, updateError);
        continue;
      }
      memberData = updated;
    } else {
      // Create new member (no guild_id column in members table)
      const { data: inserted, error: insertError } = await supabase
        .from('members')
        .insert({
          ign: member.ign,
          idlemmo_id: null, // Activity logs don't have IdleMMO IDs
          position: 'SOLDIER', // Default position for manual entries
          is_active: true,
          last_seen: log_date,
          first_seen: log_date,
        })
        .select()
        .single();

      if (insertError) {
        console.error(`Failed to insert member ${member.ign}:`, insertError);
        continue;
      }
      memberData = inserted;
    }

    if (!memberData) {
      console.error(`Failed to upsert member ${member.ign}: No data returned`);
      continue;
    }

    // Determine if member met requirement:
    // - Either donated >= 5k gold (or configured amount)
    // - OR donated >= 50% of the challenge total cost
    const metsDonationReq = member.gold >= donationReq;
    const metsChallengeReq = halfChallengeReq > 0 && member.gold >= halfChallengeReq;
    const metRequirement = metsDonationReq || metsChallengeReq;

    // Upsert daily log
    const { error: logError } = await supabase
      .from('daily_logs')
      .upsert({
        member_id: memberData.id,
        log_date,
        raids: member.raids,
        gold_donated: member.gold,
        met_requirement: metRequirement,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'member_id,log_date' });

    if (logError) {
      console.error(`Failed to upsert log for ${member.ign}:`, logError);
      continue;
    }

    saved++;
  }

  return NextResponse.json({ success: true, saved });
}
