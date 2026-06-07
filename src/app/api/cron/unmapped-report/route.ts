import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { postToChannel } from '@/lib/discord-api';

const UNMAPPED_CHANNEL_ID = '1444748653435682949';

// POST /api/cron/unmapped-report — post unmapped members per guild to Discord
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('Authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient();

  // Fetch all active unmapped members with guild config info
  const { data: members, error } = await supabase
    .from('members')
    .select('ign, current_guild_id')
    .is('discord_id', null)
    .eq('is_active', true)
    .order('current_guild_id')
    .order('ign');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!members || members.length === 0) {
    return NextResponse.json({ ok: true, total: 0, message: 'All members mapped' });
  }

  // Get guild names
  const guildIds = Array.from(new Set(members.map((m) => m.current_guild_id).filter(Boolean))) as string[];
  const { data: configs } = await supabase
    .from('guild_config')
    .select('guild_id, guild_name')
    .in('guild_id', guildIds);

  const nameMap = new Map((configs ?? []).map((c) => [c.guild_id, c.guild_name]));

  // Get total member counts per guild for context
  const { data: totals } = await supabase
    .from('members')
    .select('current_guild_id')
    .in('current_guild_id', guildIds)
    .eq('is_active', true);

  const totalMap = new Map<string, number>();
  for (const row of totals ?? []) {
    if (row.current_guild_id) {
      totalMap.set(row.current_guild_id, (totalMap.get(row.current_guild_id) ?? 0) + 1);
    }
  }

  // Group unmapped by guild
  const byGuild = new Map<string, string[]>();
  for (const m of members) {
    if (!m.current_guild_id) continue;
    const arr = byGuild.get(m.current_guild_id) ?? [];
    arr.push(m.ign);
    byGuild.set(m.current_guild_id, arr);
  }

  // Header message with total
  const totalUnmapped = members.length;
  const totalMembers = Array.from(totalMap.values()).reduce((a, b) => a + b, 0);
  await postToChannel(
    UNMAPPED_CHANNEL_ID,
    `🔔 **Unmapped Members Report**\n${totalUnmapped} of ${totalMembers} active members across ${byGuild.size} guild${byGuild.size !== 1 ? 's' : ''} need a Discord mapping.`
  );

  // Per-guild messages
  const results: Array<{ guild: string; unmapped: number; ok: boolean }> = [];

  for (const [guildId, unmappedIgNs] of Array.from(byGuild.entries())) {
    const guildName = nameMap.get(guildId) ?? guildId;
    const total = totalMap.get(guildId) ?? unmappedIgNs.length;
    const lines = unmappedIgNs.map((ign: string) => `• ${ign}`).join('\n');
    const msg = `▸ **${guildName}** — ${unmappedIgNs.length} of ${total} unmapped\n${lines}\n​`;

    const result = await postToChannel(UNMAPPED_CHANNEL_ID, msg);
    results.push({ guild: guildName, unmapped: unmappedIgNs.length, ok: result.ok });
  }

  return NextResponse.json({ ok: true, total: members.length, results });
}
