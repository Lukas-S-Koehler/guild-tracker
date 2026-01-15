import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { verifyAuth, isErrorResponse } from '@/lib/auth-helpers';
import { getMemberApiKey } from '@/lib/member-api-key';

/**
 * POST /api/members/sync-all
 * Sync in-game members for ALL guilds from IdleMMO API
 * Accessible to OFFICER and above
 */
export async function POST(req: NextRequest) {
  console.log("=== SYNC ALL GUILDS MEMBERS START ===");

  // Verify authentication and require at least OFFICER role
  const authResult = await verifyAuth(req, 'OFFICER');
  if (isErrorResponse(authResult)) return authResult;
  const { user, guildId: userGuildId } = authResult;

  const supabase = createServerClient(req);

  // Get the member's personal API key
  const apiKey = await getMemberApiKey(supabase, user.id, userGuildId);

  if (!apiKey) {
    console.log("❌ No API key found for member");
    return NextResponse.json(
      { error: 'API key not configured. Go to Settings to add your IdleMMO API key.' },
      { status: 400 }
    );
  }

  try {
    // Fetch ALL guilds from database
    const { data: guilds, error: guildsError } = await supabase
      .from('guilds')
      .select('id, name, nickname')
      .order('display_order', { ascending: true });

    if (guildsError) {
      console.error('[Sync All] Error fetching guilds:', guildsError);
      return NextResponse.json({ error: 'Failed to fetch guilds from database' }, { status: 500 });
    }

    if (!guilds || guilds.length === 0) {
      return NextResponse.json({ error: 'No guilds found in database' }, { status: 404 });
    }

    console.log(`[Sync All] Found ${guilds.length} guilds to sync`);

    const results = [];
    let totalSynced = 0;
    let totalErrors = 0;

    // Sync each guild
    for (const guild of guilds) {
      try {
        console.log(`[Sync All] Syncing guild: ${guild.nickname} (${guild.name})`);

        const url = `https://api.idle-mmo.com/v1/guild/${guild.id}/members`;

        // Fetch members from IdleMMO
        const res = await fetch(url, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'User-Agent': 'GuildTracker/1.0',
          },
        });

        if (!res.ok) {
          const errorText = await res.text();
          console.error(`[Sync All] Error fetching ${guild.nickname}:`, res.status, errorText);
          results.push({
            guild_id: guild.id,
            guild_name: guild.name,
            success: false,
            error: `API returned ${res.status}`,
          });
          totalErrors++;
          continue;
        }

        const data = await res.json();

        if (!data.members || !Array.isArray(data.members)) {
          console.error(`[Sync All] Invalid response for ${guild.nickname}`);
          results.push({
            guild_id: guild.id,
            guild_name: guild.name,
            success: false,
            error: 'Invalid API response',
          });
          totalErrors++;
          continue;
        }

        // Get existing members to check who's new to this guild
        const memberIds = data.members.map((m: any) => m.name.toLowerCase());
        const { data: existingMembers } = await supabase
          .from('members')
          .select('idlemmo_id, current_guild_id')
          .in('idlemmo_id', memberIds);

        // Create a map of existing members
        const existingMap = new Map<string, string | null>();
        existingMembers?.forEach(m => {
          existingMap.set(m.idlemmo_id, m.current_guild_id);
        });

        const today = new Date().toISOString().split('T')[0];

        // Transform members data - set first_seen for new guild members
        const members = data.members.map((m: any) => {
          const idlemmoId = m.name.toLowerCase();
          const existingGuildId = existingMap.get(idlemmoId);
          const isNewToGuild = existingGuildId === undefined || existingGuildId !== guild.id;

          return {
            guild_id: guild.id, // Legacy column (NOT NULL constraint)
            current_guild_id: guild.id,
            idlemmo_id: idlemmoId,
            ign: m.name,
            position: m.position,
            total_level: m.total_level,
            avatar_url: m.avatar_url,
            is_active: true,
            synced_at: new Date().toISOString(),
            // Set first_seen to today if new to this guild
            ...(isNewToGuild ? { first_seen: today } : {}),
          };
        });

        // Upsert to database
        const { error: upsertError } = await supabase
          .from('members')
          .upsert(members, { onConflict: 'idlemmo_id' });

        if (upsertError) {
          console.error(`[Sync All] Upsert error for ${guild.nickname}:`, upsertError);
          results.push({
            guild_id: guild.id,
            guild_name: guild.name,
            success: false,
            error: upsertError.message,
          });
          totalErrors++;
        } else {
          console.log(`[Sync All] ✅ Synced ${members.length} members for ${guild.nickname}`);
          results.push({
            guild_id: guild.id,
            guild_name: guild.name,
            success: true,
            member_count: members.length,
          });
          totalSynced += members.length;
        }

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        console.error(`[Sync All] Error syncing ${guild.nickname}:`, error);
        results.push({
          guild_id: guild.id,
          guild_name: guild.name,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        totalErrors++;
      }
    }

    console.log(`=== SYNC ALL COMPLETE: ${totalSynced} members synced, ${totalErrors} errors ===`);

    return NextResponse.json({
      success: totalErrors === 0,
      total_guilds: guilds.length,
      total_members_synced: totalSynced,
      total_errors: totalErrors,
      results,
    });

  } catch (error) {
    console.error('[Sync All] Fatal error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
