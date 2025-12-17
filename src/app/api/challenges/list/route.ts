// app/api/challenges/list/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { verifyAuth, isErrorResponse } from '@/lib/auth-helpers';

export async function GET(req: NextRequest) {
  // Verify authentication (members can view challenges)
  const auth = await verifyAuth(req, 'MEMBER');
  if (isErrorResponse(auth)) return auth;

  const supabase = createServerClient(req);

  try {
    const { searchParams } = new URL(req.url);
    const date = searchParams.get('date');

    // Query challenges for the authenticated guild (RLS will also filter)
    let query = supabase
      .from('challenges')
      .select('id, challenge_date, total_cost, items')
      .eq('guild_id', auth.guildId)
      .order('created_at', { ascending: false });

    // If date is provided, filter for that specific date
    if (date) {
      query = query.eq('challenge_date', date);
    } else {
      query = query.limit(50);
    }

    const { data: challenges, error: challengesError } = await query;

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
