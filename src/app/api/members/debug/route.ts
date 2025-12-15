import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

export async function GET() {
  const supabase = createServerClient();

  const { data, error } = await supabase
    .from('members')
    .select('*');

  console.log("DEBUG MEMBERS:", data, error);

  return NextResponse.json({ data, error });
}
