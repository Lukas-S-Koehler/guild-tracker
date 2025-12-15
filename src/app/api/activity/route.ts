import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase';
import type { ProcessedMember } from '@/types';

export async function GET(req: NextRequest) {
  const supabase = createClient();
  const { searchParams } = new URL(req.url);

  const date = searchParams.get('date');

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
  const supabase = createClient();
  const body = await req.json();

  const { log_date, members } = body as { log_date: string; members: ProcessedMember[] };

  if (!log_date || !members || members.length === 0) {
    return NextResponse.json({ error: 'Date and members are required' }, { status: 400 });
  }

  // Get config for donation requirement
  const { data: config } = await supabase
    .from('guild_config')
    .select('donation_requirement')
    .limit(1)
    .single();

  const donationReq = config?.donation_requirement || 5000;

  let saved = 0;

  for (const member of members) {
    // Upsert member
    const { data: memberData, error: memberError } = await supabase
      .from('members')
      .upsert({
        ign: member.ign,
        last_seen: log_date,
      }, { onConflict: 'ign' })
      .select()
      .single();

    if (memberError || !memberData) {
      console.error(`Failed to upsert member ${member.ign}:`, memberError);
      continue;
    }

    // Update first_seen if not set
    if (!memberData.first_seen) {
      await supabase
        .from('members')
        .update({ first_seen: log_date })
        .eq('id', memberData.id);
    }

    // Upsert daily log
    const { error: logError } = await supabase
      .from('daily_logs')
      .upsert({
        member_id: memberData.id,
        log_date,
        raids: member.raids,
        gold_donated: member.gold,
        met_requirement: member.gold >= donationReq,
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
