import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { verifySuperAdmin, isErrorResponse } from '@/lib/auth-helpers';

export interface MemberOverviewRow {
  id: string;
  ign: string;
  guild_id: string;
  guild_name: string;
  guild_nickname: string;
  hashed_id: string | null;
  discord_id: string | null;
  alts_found: number;
  alts_matched: number;
}

export interface GuildOverviewStat {
  guild_id: string;
  guild_name: string;
  guild_nickname: string;
  total: number;
  with_hashed_id: number;
  without_hashed_id: number;
  with_alts: number;
}

// GET /api/admin/hashed-id-overview
export async function GET(req: NextRequest) {
  const auth = await verifySuperAdmin(req);
  if (isErrorResponse(auth)) return auth;

  const supabase = createAdminClient();

  const [membersRes, guildsRes, altsRes] = await Promise.all([
    supabase
      .from('members')
      .select('id, ign, current_guild_id, hashed_id, discord_id')
      .eq('is_active', true),
    supabase
      .from('guilds')
      .select('id, name, nickname')
      .eq('is_active', true),
    supabase
      .from('member_alts')
      .select('member_id, alt_member_id'),
  ]);

  if (membersRes.error) return NextResponse.json({ error: membersRes.error.message }, { status: 500 });

  const guildMap = new Map((guildsRes.data ?? []).map(g => [g.id, g]));

  // Count alts per member
  const altCountByMember = new Map<string, { found: number; matched: number }>();
  for (const alt of altsRes.data ?? []) {
    const cur = altCountByMember.get(alt.member_id) ?? { found: 0, matched: 0 };
    cur.found++;
    if (alt.alt_member_id) cur.matched++;
    altCountByMember.set(alt.member_id, cur);
  }

  const members: MemberOverviewRow[] = (membersRes.data ?? []).map(m => {
    const guild = guildMap.get(m.current_guild_id ?? '');
    const altStats = altCountByMember.get(m.id) ?? { found: 0, matched: 0 };
    return {
      id: m.id,
      ign: m.ign,
      guild_id: m.current_guild_id ?? '',
      guild_name: guild?.name ?? 'Unknown',
      guild_nickname: guild?.nickname ?? '',
      hashed_id: m.hashed_id ?? null,
      discord_id: m.discord_id ?? null,
      alts_found: altStats.found,
      alts_matched: altStats.matched,
    };
  });

  // Per-guild stats
  const guildStats = new Map<string, GuildOverviewStat>();
  for (const m of members) {
    if (!m.guild_id) continue;
    const stat = guildStats.get(m.guild_id) ?? {
      guild_id: m.guild_id,
      guild_name: m.guild_name,
      guild_nickname: m.guild_nickname,
      total: 0,
      with_hashed_id: 0,
      without_hashed_id: 0,
      with_alts: 0,
    };
    stat.total++;
    if (m.hashed_id) stat.with_hashed_id++;
    else stat.without_hashed_id++;
    if (m.alts_found > 0) stat.with_alts++;
    guildStats.set(m.guild_id, stat);
  }

  return NextResponse.json({
    members,
    guild_stats: Array.from(guildStats.values()).sort((a, b) => a.guild_nickname.localeCompare(b.guild_nickname)),
    totals: {
      members: members.length,
      with_hashed_id: members.filter(m => m.hashed_id).length,
      without_hashed_id: members.filter(m => !m.hashed_id).length,
      with_alts: members.filter(m => m.alts_found > 0).length,
      alts_matched: members.reduce((s, m) => s + m.alts_matched, 0),
    },
  });
}
