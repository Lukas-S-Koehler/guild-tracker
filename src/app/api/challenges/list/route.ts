// app/api/challenges/list/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  const supabase = createClient();

  try {
    // Get guild_id from config
    const { data: config, error: configError } = await supabase
      .from('guild_config')
      .select('guild_id')
      .limit(1)
      .single();

    if (configError || !config?.guild_id) {
      return NextResponse.json({ error: 'Guild not configured' }, { status: 400 });
    }

    // Query challenges for this guild, newest first
    const { data: challenges, error: challengesError } = await supabase
      .from('challenges')
      .select('id, challenge_date, total_cost, items')
      .eq('guild_id', config.guild_id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (challengesError) {
      console.error('Error fetching challenges:', challengesError);
      return NextResponse.json({ error: challengesError.message }, { status: 500 });
    }

    // Ensure items is parsed/normalized (supabase returns JSON already)
    return NextResponse.json(Array.isArray(challenges) ? challenges : []);
  } catch (err: any) {
    console.error('GET /api/challenges/list error:', err);
    return NextResponse.json({ error: err.message || 'Failed to list challenges' }, { status: 500 });
  }
}
