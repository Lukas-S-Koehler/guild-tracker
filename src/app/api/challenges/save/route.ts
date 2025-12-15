import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  const supabase = createClient();

  try {
    const body = await req.json();
    const { raw_input, items, total_cost } = body;

    if (!raw_input || !items || !Array.isArray(items)) {
      return NextResponse.json(
        { error: 'Missing required challenge data' },
        { status: 400 }
      );
    }

    // 🔑 Fetch guild_id from config table
    const { data: config, error: configError } = await supabase
      .from('guild_config')
      .select('guild_id')
      .limit(1)
      .single();

    if (configError || !config?.guild_id) {
      return NextResponse.json(
        { error: 'Guild ID not configured. Please run Setup first.' },
        { status: 400 }
      );
    }

    // 📝 Insert into challenges table
    const { error: insertError, data } = await supabase
      .from('challenges')
      .insert({
        raw_input,
        items, // jsonb
        total_cost,
        guild_id: config.guild_id,
        challenge_date: new Date().toISOString().split('T')[0], // YYYY-MM-DD
        is_completed: false,
      })
      .select();

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to save challenge' },
      { status: 500 }
    );
  }
}
