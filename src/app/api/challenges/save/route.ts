import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { verifyAuth, isErrorResponse } from '@/lib/auth-helpers';

export async function POST(req: NextRequest) {
  // Verify authentication (officers and leaders can save challenges)
  const auth = await verifyAuth(req, 'OFFICER');
  if (isErrorResponse(auth)) return auth;

  const supabase = createServerClient(req);

  try {
    const body = await req.json();
    const { raw_input, items, total_cost } = body;

    if (!raw_input || !items || !Array.isArray(items)) {
      return NextResponse.json(
        { error: 'Missing required challenge data' },
        { status: 400 }
      );
    }

    // 📝 Insert into challenges table using authenticated guild
    const { error: insertError, data } = await supabase
      .from('challenges')
      .insert({
        raw_input,
        items, // jsonb
        total_cost,
        guild_id: auth.guildId,
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
