import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { requireUser, isResponse } from '@/lib/user-auth';
import { getAllClaimLocks } from '@/lib/account-service';

export const dynamic = 'force-dynamic';

/** GET /api/account/search?q= — characters currently in any Dream guild, for claiming. */
export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;

  const q = (new URL(req.url).searchParams.get('q') ?? '').trim();
  if (q.length < 2) return NextResponse.json({ results: [] });

  const supabase = createAdminClient();
  const [{ data: guilds }, { data: members }] = await Promise.all([
    supabase.from('guilds').select('id, name, nickname'),
    supabase
      .from('members')
      .select('id, ign, avatar_url, total_level, current_guild_id')
      .ilike('ign', `%${q.replace(/[%_]/g, '')}%`)
      .eq('is_active', true)
      .not('current_guild_id', 'is', null)
      .order('ign')
      .limit(30),
  ]);
  const guildMap = new Map((guilds ?? []).map((g) => [g.id as string, g]));
  // Locks cover pending + approved claims, expanded over each claim's alt bundle.
  const locks = await getAllClaimLocks(supabase);
  const hasActiveClaim = Array.from(locks.values()).some((l) => l.user_id === user.id);

  const results = (members ?? [])
    .filter((m) => guildMap.has(m.current_guild_id))
    .map((m) => {
      const lock = locks.get(m.id);
      const mine = lock?.user_id === user.id;
      return {
        member_id: m.id,
        ign: m.ign,
        avatar_url: m.avatar_url,
        total_level: m.total_level,
        guild_nickname: guildMap.get(m.current_guild_id)?.nickname ?? null,
        guild_name: guildMap.get(m.current_guild_id)?.name ?? null,
        /** 'claimed' | 'pending' when locked by someone else */
        taken: !!lock && !mine,
        taken_status: lock && !mine ? (lock.status === 'approved' ? 'claimed' : 'pending') : null,
        mine,
      };
    });
  return NextResponse.json({ results, has_active_claim: hasActiveClaim });
}
