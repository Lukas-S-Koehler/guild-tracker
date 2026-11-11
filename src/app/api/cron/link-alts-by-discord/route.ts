import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { verifyAuth, isErrorResponse } from '@/lib/auth-helpers';
import { linkAltsBySharedDiscord } from '@/lib/discord-alt-link';

export const dynamic = 'force-dynamic';

// POST /api/cron/link-alts-by-discord
// Sweeps every discord_id with ≥2 tracked members and ensures manual alt rows exist between them.
// Accepts CRON_SECRET bearer (preferred) or officer session.
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('Authorization');
  const isCron = !!process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`;
  if (!isCron) {
    const auth = await verifyAuth(req, 'OFFICER');
    if (isErrorResponse(auth)) return auth;
  }

  const supabase = createAdminClient();
  const { data: members, error } = await supabase
    .from('members')
    .select('discord_id')
    .eq('is_active', true)
    .not('discord_id', 'is', null)
    .not('hashed_id', 'is', null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const counts = new Map<string, number>();
  for (const m of members ?? []) {
    if (!m.discord_id) continue;
    counts.set(m.discord_id, (counts.get(m.discord_id) ?? 0) + 1);
  }

  const multi = Array.from(counts.entries()).filter(([, n]) => n >= 2).map(([id]) => id);

  let accountsProcessed = 0;
  let linksCreated = 0;
  const errors: string[] = [];
  for (const discordId of multi) {
    try {
      const r = await linkAltsBySharedDiscord(supabase, discordId);
      if (r.account_size >= 2) {
        accountsProcessed++;
        linksCreated += r.created;
      }
    } catch (err) {
      errors.push(`${discordId}: ${String(err)}`);
    }
  }

  return NextResponse.json({
    scanned: counts.size,
    multi_member_accounts: multi.length,
    accounts_processed: accountsProcessed,
    links_created: linksCreated,
    error_count: errors.length,
    errors: errors.slice(0, 20),
  });
}
