import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { IdleMMOApi, ActivityEvent } from '@/lib/idlemmo-api';
import { storeActivityEvents, processActivityEvents, drainInactiveBanks } from '@/lib/activity-processor';

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

  const supabase = createAdminClient();

  // Fetch all guilds that have a real API key configured
  const { data: guilds, error: guildsError } = await supabase
    .from('guild_config')
    .select('guild_id, api_key')
    .neq('api_key', 'placeholder')
    .not('api_key', 'is', null);

  if (guildsError || !guilds) {
    return NextResponse.json({ error: 'Failed to fetch guilds', details: guildsError?.message }, { status: 500 });
  }

  const results: Record<string, { stored: number; processed: number; joins: string[]; leaves: string[]; error?: string }> = {};

  // Track which guilds need member sync due to joins
  const guildsNeedingSync: string[] = [];

  for (const guild of guilds) {
    const { guild_id, api_key } = guild;

    try {
      const api = new IdleMMOApi(api_key);

      // Fetch guild config to get last_fetched_at cutoff and existing settings
      const { data: existingConfig } = await supabase
        .from('guild_config')
        .select('settings')
        .eq('guild_id', guild_id)
        .single();

      const lastFetchedAt = existingConfig?.settings?.last_fetched_at
        ? new Date(existingConfig.settings.last_fetched_at)
        : null;

      // Paginate until no more pages or all events are older than last fetch
      const allEvents: ActivityEvent[] = [];
      let endpointUpdatesAt: string | null = null;
      let page = 1;
      let done = false;

      while (!done) {
        const response = await api.getGuildActivity(guild_id, page);
        if (!response.activity?.length) break;

        if (page === 1) endpointUpdatesAt = response.endpoint_updates_at ?? null;

        for (const event of response.activity) {
          const eventTime = new Date(event.created_at);
          // 2h overlap buffer handles cron delays; stops re-processing old history
          if (lastFetchedAt && eventTime < new Date(lastFetchedAt.getTime() - 2 * 60 * 60 * 1000)) {
            done = true;
            break;
          }
          allEvents.push(event);
        }

        if (!response.pagination.has_more) break;
        page++;
        await new Promise(r => setTimeout(r, 300));
      }

      // Store raw events (idempotent via upsert)
      const stored = await storeActivityEvents(allEvents, guild_id, supabase);

      // Process into daily_logs
      const { processed, joins, leaves } = await processActivityEvents(
        allEvents,
        guild_id,
        supabase,
        api_key
      );

      results[guild_id] = { stored, processed, joins, leaves };

      // Drain bank for all active members who had no events today
      await drainInactiveBanks(guild_id, supabase);

      if (joins.length > 0) {
        guildsNeedingSync.push(guild_id);
      }

      // Record last_fetched_at; also sync members if new joins detected
      const settingsUpdate: Record<string, unknown> = {
        ...(existingConfig?.settings || {}),
        last_fetched_at: new Date().toISOString(),
        ...(endpointUpdatesAt ? { last_endpoint_updates_at: endpointUpdatesAt } : {}),
      };

      if (joins.length > 0) {
        // Sync members for this guild immediately since new members were detected
        try {
          const memberRes = await fetch(`https://api.idle-mmo.com/v1/guild/${guild_id}/members`, {
            headers: { Authorization: `Bearer ${api_key}`, 'User-Agent': 'GuildTracker/1.0' },
          });

          if (memberRes.ok) {
            const memberData = await memberRes.json();
            const apiMembers = memberData.members || [];

            if (apiMembers.length > 0) {
              const memberIds = apiMembers.map((m: any) => m.name.toLowerCase());
              const { data: existingMembers } = await supabase
                .from('members')
                .select('idlemmo_id, current_guild_id, first_seen')
                .in('idlemmo_id', memberIds);

              const existingMap = new Map<string, { current_guild_id: string | null; first_seen: string | null }>();
              existingMembers?.forEach((m: any) => {
                existingMap.set(m.idlemmo_id, { current_guild_id: m.current_guild_id, first_seen: m.first_seen });
              });

              const today = new Date().toISOString().split('T')[0];
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
                  ...(m.hashed_id ? { hashed_id: m.hashed_id } : {}),
                };
              });

              await supabase.from('members').upsert(members, { onConflict: 'idlemmo_id' });

              const syncedIds = members.map((m: any) => m.idlemmo_id);
              await supabase
                .from('members')
                .update({ is_active: false })
                .eq('current_guild_id', guild_id)
                .not('idlemmo_id', 'in', `(${syncedIds.map((id: string) => `"${id}"`).join(',')})`);

              settingsUpdate.last_member_synced_at = new Date().toISOString();
            }
          }
        } catch (_) {
          // Member sync failure is non-fatal — activity was still processed
        }
      }

      const { error: updateErr } = await supabase
        .from('guild_config')
        .update({ settings: settingsUpdate })
        .eq('guild_id', guild_id);

      if (updateErr) {
        console.error(`[daily-activity] Failed to update settings for ${guild_id}:`, updateErr.message);
      }
    } catch (err) {
      results[guild_id] = { stored: 0, processed: 0, joins: [], leaves: [], error: String(err) };
    }
  }

  return NextResponse.json({
    success: true,
    guildsProcessed: guilds.length,
    guildsNeedingMemberSync: guildsNeedingSync,
    results,
  });
}
