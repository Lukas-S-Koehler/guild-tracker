import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { loadGuildDirectory } from '@/lib/guild-directory';

export const dynamic = 'force-dynamic';

// GET /api/guilds/directory — public. Whitelisted guild info + last-7-day stats.
export async function GET() {
  try {
    return NextResponse.json(await loadGuildDirectory(createAdminClient()));
  } catch (e) {
    console.error('[guilds/directory]', e);
    return NextResponse.json({ error: 'Failed to load guild directory' }, { status: 500 });
  }
}
