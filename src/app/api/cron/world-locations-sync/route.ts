import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { IdleMMOApi } from '@/lib/idlemmo-api';
import { syncWorldLocations } from '@/lib/world-locations';

export const dynamic = 'force-dynamic';

const SUPER_ADMIN_USER_ID = '5f33bb41-86ab-4024-a1da-6a2fea5fb36b';

// POST /api/cron/world-locations-sync  (Bearer CRON_SECRET) - images + weather forecast.
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const supabase = createAdminClient();
  const { data: keyRow } = await supabase.from('user_api_keys').select('api_key').eq('user_id', SUPER_ADMIN_USER_ID).single();
  if (!keyRow?.api_key) return NextResponse.json({ error: 'No API key configured for super admin' }, { status: 400 });
  try {
    const n = await syncWorldLocations(new IdleMMOApi(keyRow.api_key));
    return NextResponse.json({ success: true, locations: n });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
