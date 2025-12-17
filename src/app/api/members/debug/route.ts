import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

export async function GET(req: NextRequest) {
  const supabase = createServerClient(req);

  const { data, error } = await supabase
    .from('members')
    .select('*');

  console.log("DEBUG MEMBERS:", data, error);

  return NextResponse.json({ data, error });
}
