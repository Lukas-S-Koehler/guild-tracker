import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';

// GET /api/guilds/status — public, no auth required
export async function GET(req: NextRequest) {
  const admin = createAdminClient();

  const [guildsResult, configsResult, memberSyncResult] = await Promise.all([
    admin.from('guilds').select('id, name, nickname, display_order').order('display_order'),
    admin.from('guild_config').select('guild_id, settings'),
    admin.from('members').select('current_guild_id, synced_at').eq('is_active', true),
  ]);

  if (guildsResult.error) {
    return NextResponse.json({ error: guildsResult.error.message }, { status: 500 });
  }

  const configByGuild: Record<string, any> = {};
  for (const c of configsResult.data || []) {
    configByGuild[c.guild_id] = c.settings || {};
  }

  // Derive last member sync time per guild from members.synced_at as fallback
  const latestSyncByGuild: Record<string, string> = {};
  for (const m of memberSyncResult.data || []) {
    if (!m.current_guild_id || !m.synced_at) continue;
    if (!latestSyncByGuild[m.current_guild_id] || m.synced_at > latestSyncByGuild[m.current_guild_id]) {
      latestSyncByGuild[m.current_guild_id] = m.synced_at;
    }
  }

  const guilds = (guildsResult.data || []).map(g => ({
    id: g.id,
    name: g.name,
    nickname: g.nickname,
    donation_requirement: configByGuild[g.id]?.donation_requirement ?? 5000,
    last_fetched_at: configByGuild[g.id]?.last_fetched_at ?? null,
    last_member_synced_at: configByGuild[g.id]?.last_member_synced_at ?? latestSyncByGuild[g.id] ?? null,
  }));

  return NextResponse.json(guilds);
}
