import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { verifySuperAdmin, isErrorResponse } from '@/lib/auth-helpers';
import { linkAltsBySharedDiscord } from '@/lib/discord-alt-link';

export const dynamic = 'force-dynamic';

// POST /api/admin/link-alts-by-discord
// Scans all active members, groups by discord_id, and creates manual alt links for each group ≥2.
export async function POST(req: NextRequest) {
  const auth = await verifySuperAdmin(req);
  if (isErrorResponse(auth)) return auth;

  const supabase = createAdminClient();
  const { data: members } = await supabase
    .from('members')
    .select('discord_id')
    .eq('is_active', true)
    .not('discord_id', 'is', null)
    .not('hashed_id', 'is', null);

  const counts = new Map<string, number>();
  for (const m of members ?? []) {
    if (!m.discord_id) continue;
    counts.set(m.discord_id, (counts.get(m.discord_id) ?? 0) + 1);
  }
  const multi = Array.from(counts.entries()).filter(([, n]) => n >= 2).map(([id]) => id);

  let accountsProcessed = 0;
  let linksCreated = 0;
  const details: Array<{ discord_id: string; account_size: number; created: number }> = [];

  for (const discordId of multi) {
    const r = await linkAltsBySharedDiscord(supabase, discordId);
    if (r.account_size >= 2) {
      accountsProcessed++;
      linksCreated += r.created;
      details.push({ discord_id: discordId, account_size: r.account_size, created: r.created });
    }
  }

  return NextResponse.json({
    discord_ids_with_multiple_members: multi.length,
    accounts_processed: accountsProcessed,
    links_created: linksCreated,
    details: details.slice(0, 50),
  });
}
