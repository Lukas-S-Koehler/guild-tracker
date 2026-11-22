import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { requireUser, isResponse } from '@/lib/user-auth';

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
  const ids = (members ?? []).map((m) => m.id);
  const { data: owned } = ids.length
    ? await supabase.from('user_characters').select('member_id, user_id').eq('status', 'approved').in('member_id', ids)
    : { data: [] };
  const ownerOf = new Map((owned ?? []).map((o) => [o.member_id as string, o.user_id as string]));

  const results = (members ?? [])
    .filter((m) => guildMap.has(m.current_guild_id))
    .map((m) => ({
      member_id: m.id,
      ign: m.ign,
      avatar_url: m.avatar_url,
      total_level: m.total_level,
      guild_nickname: guildMap.get(m.current_guild_id)?.nickname ?? null,
      guild_name: guildMap.get(m.current_guild_id)?.name ?? null,
      taken: ownerOf.has(m.id) && ownerOf.get(m.id) !== user.id,
      mine: ownerOf.get(m.id) === user.id,
    }));
  return NextResponse.json({ results });
}
