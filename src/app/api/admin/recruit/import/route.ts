import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase-server';
import { importInbox, staffName } from '@/lib/recruit-service';
import { parseInbox } from '@/lib/recruit-parse';

export const dynamic = 'force-dynamic';

/** Import a pasted in-game message list. Body: { text } */
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req, 'DEPUTY');
  if (auth instanceof NextResponse) return auth;
  const body = (await req.json().catch(() => null)) as { text?: string } | null;
  const entries = parseInbox((body?.text ?? '').slice(0, 500_000));
  if (!entries.length) {
    return NextResponse.json({ error: 'No messages found. Copy the message list including the player links.' }, { status: 400 });
  }
  const supabase = createAdminClient();
  try {
    const actor = { id: auth.user.id, name: await staffName(supabase, auth.user.id, auth.guildId) };
    return NextResponse.json({ parsed: entries.length, ...(await importInbox(supabase, entries, actor)) });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
