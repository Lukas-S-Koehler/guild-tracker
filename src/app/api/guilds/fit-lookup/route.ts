import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { IdleMMOApi } from '@/lib/idlemmo-api';

export const dynamic = 'force-dynamic';

const CL_REFRESH_MS = 86_400_000;

/**
 * GET /api/guilds/fit-lookup?ign= — public. Combat level of a character we track, for the
 * "which guild fits me" picker. CL is public in game. Refreshes members.combat_level from the
 * character info API at most once a day per character (same rule as /me).
 */
export async function GET(req: NextRequest) {
  const ign = new URL(req.url).searchParams.get('ign')?.trim();
  if (!ign || ign.length > 40) return NextResponse.json({ error: 'ign required' }, { status: 400 });

  const supabase = createAdminClient();
  const { data: rows, error } = await supabase
    .from('members')
    .select('id, ign, hashed_id, combat_level, combat_level_synced_at, is_active, current_guild_id')
    .ilike('ign', ign.replace(/[%_\\]/g, '\\$&'))
    .order('is_active', { ascending: false })
    .limit(1);
  if (error) return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
  const m = rows?.[0] as any;
  if (!m) return NextResponse.json({ found: false });

  let cl: number | null = m.combat_level ?? null;
  const fresh = m.combat_level_synced_at && Date.now() - new Date(m.combat_level_synced_at).getTime() < CL_REFRESH_MS;
  if (!fresh && m.hashed_id) {
    const { data: k } = await supabase.from('guild_config').select('api_key').not('api_key', 'is', null).limit(1).maybeSingle();
    if (k?.api_key) {
      try {
        const info = await new IdleMMOApi(k.api_key as string).getCharacterInformation(m.hashed_id);
        const live = info.skills?.combat?.level;
        if (typeof live === 'number' && live > 0) {
          cl = live;
          await supabase.from('members').update({ combat_level: live, combat_level_synced_at: new Date().toISOString() }).eq('id', m.id);
        }
      } catch (e) {
        console.warn('[fit-lookup] CL fetch failed for', m.ign, e);
      }
    }
  }
  const { data: g } = m.is_active && m.current_guild_id
    ? await supabase.from('guilds').select('name, nickname').eq('id', m.current_guild_id).maybeSingle()
    : { data: null };
  return NextResponse.json({
    found: true,
    ign: m.ign,
    combat_level: cl,
    guild: m.is_active && g ? { name: g.name, tag: g.nickname } : null,
  });
}
