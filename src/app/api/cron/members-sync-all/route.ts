import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';

function verifyCronSecret(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get('authorization');
  return auth === `Bearer ${secret}`;
}

export async function POST(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const { guild_ids } = body as { guild_ids?: string[] };

  const supabase = createAdminClient();

  // Fetch guilds to sync
  let query = supabase
    .from('guild_config')
    .select('guild_id, api_key')
    .neq('api_key', 'placeholder')
    .not('api_key', 'is', null);

  if (guild_ids && guild_ids.length > 0) {
    query = query.in('guild_id', guild_ids);
  }

  const { data: guilds, error } = await query;

  if (error || !guilds) {
    return NextResponse.json({ error: 'Failed to fetch guilds' }, { status: 500 });
  }

  const today = new Date().toISOString().split('T')[0];
  const results: Record<string, { synced: number; error?: string }> = {};

  for (const guild of guilds) {
    const { guild_id, api_key } = guild;

    try {
      const url = `https://api.idle-mmo.com/v1/guild/${guild_id}/members`;
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${api_key}`,
          'User-Agent': 'GuildTracker/1.0',
        },
      });

      if (!res.ok) {
        results[guild_id] = { synced: 0, error: `API ${res.status}` };
        continue;
      }

      const data = await res.json();
      const apiMembers = data.members || [];

      if (apiMembers.length === 0) {
        results[guild_id] = { synced: 0 };
        continue;
      }

      // Get existing members for this guild to detect new vs existing
      const memberIds = apiMembers.map((m: any) => m.name.toLowerCase());
      const { data: existing } = await supabase
        .from('members')
        .select('idlemmo_id, current_guild_id, first_seen')
        .in('idlemmo_id', memberIds);

      const existingMap = new Map<string, { current_guild_id: string | null; first_seen: string | null }>();
      existing?.forEach((m: any) => {
        existingMap.set(m.idlemmo_id, { current_guild_id: m.current_guild_id, first_seen: m.first_seen });
      });

      const members = apiMembers.map((m: any) => {
        const idlemmoId = m.name.toLowerCase();
        const ex = existingMap.get(idlemmoId);
        const isNewToGuild = !ex || ex.current_guild_id !== guild_id;

        return {
          guild_id,
          current_guild_id: guild_id,
          idlemmo_id: idlemmoId,
          ign: m.name,
          position: m.position,
          total_level: m.total_level,
          avatar_url: m.avatar_url,
          is_active: true,
          synced_at: new Date().toISOString(),
          ...(isNewToGuild ? { first_seen: today } : {}),
        };
      });

      const { error: upsertError } = await supabase
        .from('members')
        .upsert(members, { onConflict: 'idlemmo_id' });

      if (upsertError) {
        results[guild_id] = { synced: 0, error: upsertError.message };
        continue;
      }

      // Deactivate members who are no longer in guild
      const syncedIds = members.map((m: any) => m.idlemmo_id);
      await supabase
        .from('members')
        .update({ is_active: false })
        .eq('current_guild_id', guild_id)
        .not('idlemmo_id', 'in', `(${syncedIds.map((id: string) => `"${id}"`).join(',')})`);

      results[guild_id] = { synced: members.length };

      // Update last_member_synced_at
      const { data: existingConfig } = await supabase
        .from('guild_config')
        .select('settings')
        .eq('guild_id', guild_id)
        .single();
      await supabase
        .from('guild_config')
        .update({ settings: { ...(existingConfig?.settings || {}), last_member_synced_at: new Date().toISOString() } })
        .eq('guild_id', guild_id);
    } catch (err) {
      results[guild_id] = { synced: 0, error: String(err) };
    }
  }

  return NextResponse.json({ success: true, results });
}
