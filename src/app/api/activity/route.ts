import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { verifyAuth, isErrorResponse } from '@/lib/auth-helpers';
import type { ProcessedMember } from '@/types';

export async function GET(req: NextRequest) {
  // Verify authentication (members can view)
  const auth = await verifyAuth(req, 'MEMBER');
  if (isErrorResponse(auth)) return auth;

  const { guildId } = auth;
  const supabase = createServerClient(req);
  const { searchParams } = new URL(req.url);

  const date = searchParams.get('date');

  // Filter by guild_id from authenticated context
  let query = supabase
    .from('daily_logs')
    .select(`
      *,
      members (id, ign)
    `)
    .eq('guild_id', guildId)
    .order('gold_donated', { ascending: false });

  if (date) {
    query = query.eq('log_date', date);
  }

  const { data, error } = await query;

  if (error) {
    console.error('[Activity GET] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data || []);
}

export async function POST(req: NextRequest) {
  // Verify authentication (officers and leaders can save activity logs)
  const auth = await verifyAuth(req, 'OFFICER');
  if (isErrorResponse(auth)) return auth;

  const supabase = createServerClient(req);
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
    let memberData;
    const ignLower = member.ign.toLowerCase();

    // Try to find member by idlemmo_id (case-insensitive IGN) first - covers synced members and placeholders
    let { data: existingMember } = await supabase
      .from('members')
      .select('*')
      .eq('idlemmo_id', ignLower)
      .maybeSingle();

    if (!existingMember) {
      // If not found by idlemmo_id, search by IGN in current guild (legacy/manual entries)
      const { data: legacyMember } = await supabase
        .from('members')
        .select('*')
        .eq('ign', member.ign)
        .eq('current_guild_id', auth.guildId)
        .maybeSingle();

      existingMember = legacyMember;
    }

    if (existingMember) {
      // Member exists - update last_seen and ensure they're in current guild
      const updateData: any = { last_seen: log_date };

      // If member moved guilds or was inactive, reactivate in current guild
      if (existingMember.current_guild_id !== auth.guildId) {
        console.log(`[Activity] Member ${member.ign} moved from ${existingMember.current_guild_id} to ${auth.guildId}`);
        updateData.current_guild_id = auth.guildId;
        updateData.guild_id = auth.guildId; // Legacy column
        updateData.is_active = true;
      }

      const { data: updated, error: updateError } = await supabase
        .from('members')
        .update(updateData)
        .eq('id', existingMember.id)
        .select()
        .single();

      if (updateError) {
        console.error(`Failed to update member ${member.ign}:`, updateError);
        continue;
      }
      memberData = updated;
    } else {
      // Member not found - create placeholder
      console.log(`[Activity] Creating placeholder for ${member.ign} in guild ${auth.guildId}`);

      const { data: inserted, error: insertError } = await supabase
        .from('members')
        .insert({
          ign: member.ign,
          idlemmo_id: ignLower, // Use lowercase IGN as placeholder idlemmo_id
          guild_id: auth.guildId, // Legacy column
          current_guild_id: auth.guildId,
          position: 'RECRUIT', // Default position for placeholders
          is_active: true,
          last_seen: log_date,
          first_seen: log_date,
          total_level: 0, // Placeholder level
          avatar_url: null,
        })
        .select()
        .single();

      if (insertError) {
        console.error(`Failed to create placeholder for ${member.ign}:`, insertError);
        console.error('Error details:', insertError);
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

    // Upsert daily log with guild_id
    const { error: logError } = await supabase
      .from('daily_logs')
      .upsert({
        member_id: memberData.id,
        guild_id: auth.guildId,
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
