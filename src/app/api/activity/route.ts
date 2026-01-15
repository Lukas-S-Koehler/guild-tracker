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

  const { log_date, members, memberStatusChanges } = body as {
    log_date: string;
    members: ProcessedMember[];
    memberStatusChanges?: Array<{ ign: string; action: 'joined' | 'left' | 'kicked' }>;
  };

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
    // - Total gold (challenge donations + valid guild hall deposits) >= configured amount
    // - OR meets_challenge_quantity flag (if enabled, already calculated during parsing)
    // - OR manual override is set
    const totalGold = member.gold + (member.deposits_gold || 0);
    const metsTotalGoldReq = totalGold >= donationReq;
    const metsChallengeReq = member.meets_challenge_quantity || false;

    const metRequirement = metsTotalGoldReq || metsChallengeReq || (member.manual_override === true);

    console.log(`[Activity Save] ${member.ign}: challengeGold=${member.gold}, depositsGold=${member.deposits_gold}, totalGold=${totalGold}, donationReq=${donationReq}, metsTotalGoldReq=${metsTotalGoldReq}, meets_challenge_quantity=${member.meets_challenge_quantity}, metsChallengeReq=${metsChallengeReq}, metRequirement=${metRequirement}`);

    // Upsert daily log with guild_id
    const upsertData = {
      member_id: memberData.id,
      guild_id: auth.guildId,
      log_date,
      raids: member.raids,
      gold_donated: member.gold,
      deposits_gold: member.deposits_gold || 0,
      met_requirement: metRequirement,
      log_order: member.log_order ?? 999, // Chronological order from Discord log
      updated_at: new Date().toISOString(),
    };

    console.log(`[Activity Save] ${member.ign} - Upserting:`, JSON.stringify(upsertData));

    const { data: upsertResult, error: logError } = await supabase
      .from('daily_logs')
      .upsert(upsertData, { onConflict: 'member_id,log_date' })
      .select();

    if (logError) {
      console.error(`Failed to upsert log for ${member.ign}:`, logError);
      continue;
    }

    console.log(`[Activity Save] ${member.ign} - Upsert result:`, JSON.stringify(upsertResult));

    saved++;
  }

  // Process member status changes (joins, leaves, kicks)
  if (memberStatusChanges && memberStatusChanges.length > 0) {
    for (const change of memberStatusChanges) {
      const ignLower = change.ign.toLowerCase();

      if (change.action === 'joined') {
        // Update first_seen to this log_date for newly joined members
        // Try to find by idlemmo_id first
        let { data: existingMember } = await supabase
          .from('members')
          .select('id, first_seen')
          .eq('idlemmo_id', ignLower)
          .maybeSingle();

        if (!existingMember) {
          // Try by IGN in current guild
          const { data: legacyMember } = await supabase
            .from('members')
            .select('id, first_seen')
            .eq('ign', change.ign)
            .eq('current_guild_id', auth.guildId)
            .maybeSingle();
          existingMember = legacyMember;
        }

        if (existingMember) {
          // Update first_seen to this log_date (join date)
          console.log(`[Activity] Member ${change.ign} joined on ${log_date}, updating first_seen`);
          await supabase
            .from('members')
            .update({ first_seen: log_date })
            .eq('id', existingMember.id);
        }
      } else if (change.action === 'left' || change.action === 'kicked') {
        // Mark member as inactive (left or kicked from guild)
        let { data: existingMember } = await supabase
          .from('members')
          .select('id')
          .eq('idlemmo_id', ignLower)
          .maybeSingle();

        if (!existingMember) {
          const { data: legacyMember } = await supabase
            .from('members')
            .select('id')
            .eq('ign', change.ign)
            .eq('current_guild_id', auth.guildId)
            .maybeSingle();
          existingMember = legacyMember;
        }

        if (existingMember) {
          console.log(`[Activity] Member ${change.ign} ${change.action} guild, marking inactive`);
          await supabase
            .from('members')
            .update({ is_active: false })
            .eq('id', existingMember.id);
        }
      }
    }
  }

  return NextResponse.json({ success: true, saved });
}
