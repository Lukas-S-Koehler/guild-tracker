import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { verifyAuth, isErrorResponse } from '@/lib/auth-helpers';

export async function GET(req: NextRequest) {
  // Verify authentication (members can view reports)
  const auth = await verifyAuth(req, 'MEMBER');
  if (isErrorResponse(auth)) return auth;

  const supabase = createServerClient();

  // Use the inactivity_view which already calculates everything
  const { data: inactiveMembers, error } = await supabase
    .from('inactivity_view')
    .select('*')
    .order('days_inactive', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Filter out invalid entries and format the response
  const report = inactiveMembers
    ?.filter((m) => {
      // Filter out invalid entries
      if (!m.ign || m.ign.toLowerCase().includes('raw activity') || m.ign.toLowerCase().includes('log')) {
        return false;
      }
      // Only show inactive members (not active today)
      return m.inactivity_category !== 'active';
    })
    .map((m) => ({
      id: m.id,
      ign: m.ign,
      last_active_date: m.last_active_date,
      days_inactive: m.days_inactive,
      category: m.inactivity_category,
    }))
    .sort((a, b) => {
      // Sort by severity (never first, then by days)
      if (a.category === 'never') return -1;
      if (b.category === 'never') return 1;
      return b.days_inactive - a.days_inactive;
    });

  return NextResponse.json(report || []);
}
