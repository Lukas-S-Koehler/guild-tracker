// app/api/members/list/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

export async function GET(req: NextRequest) {
  const supabase = createServerClient(req);

  const { data, error } = await supabase
    .from('members')
    .select('*')
    .order('position', { ascending: true })
    .order('total_level', { ascending: false });

  if (error) {
    console.error('LIST MEMBERS ERROR:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
