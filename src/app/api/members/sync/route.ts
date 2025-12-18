import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { verifyAuth, isErrorResponse } from '@/lib/auth-helpers';
import { getMemberApiKey } from '@/lib/member-api-key';

/**
 * POST /api/members/sync
 * Sync in-game members for the current user's guild from IdleMMO API
 * Uses guild ID from the user's current guild context
 */
export async function POST(req: NextRequest) {
  console.log("=== SYNC MEMBERS START ===");

  // Verify authentication and get guild context
  const authResult = await verifyAuth(req);
  if (isErrorResponse(authResult)) return authResult;
  const { guildId, user } = authResult;

  const supabase = createServerClient(req);

  // Get the member's personal API key
  const apiKey = await getMemberApiKey(supabase, user.id, guildId);

  console.log("MEMBER API KEY EXISTS:", !!apiKey);
  console.log("SYNCING GUILD ID:", guildId);

  if (!apiKey) {
    console.log("❌ No API key found for member");
    return NextResponse.json(
      { error: 'API key not configured. Go to Settings to add your IdleMMO API key.' },
      { status: 400 }
    );
  }

  // Fetch guild info from database to get the actual guild ID for the API
  const { data: guildInfo, error: guildError } = await supabase
    .from('guilds')
    .select('id, name, nickname')
    .eq('id', guildId)
    .single();

  if (guildError || !guildInfo) {
    console.error('[Sync] Guild not found in database:', guildId);
    return NextResponse.json(
      { error: 'Guild not found in database' },
      { status: 404 }
    );
  }

  console.log('[Sync] Syncing guild:', guildInfo.nickname, guildInfo.name);

  const url = `https://api.idle-mmo.com/v1/guild/${guildId}/members`;
  console.log("FETCHING FROM:", url);

  // Fetch members from IdleMMO using member's API key
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'User-Agent': 'GuildTracker/1.0',
    },
  });

  console.log("IdleMMO STATUS:", res.status);

  const raw = await res.text();
  console.log("IdleMMO RAW RESPONSE:", raw);

  if (!res.ok) {
    console.log("❌ IdleMMO API error");
    return NextResponse.json(
      { error: 'IdleMMO API error', details: raw },
      { status: 500 }
    );
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    console.log("❌ Failed to parse JSON:", err);
    return NextResponse.json(
      { error: "Invalid JSON from IdleMMO", raw },
      { status: 500 }
    );
  }

  console.log("PARSED MEMBERS:", data.members);
  console.log("GUILD INFO FROM API:", data.guild);

  // Transform members data for database
  const members = data.members.map((m: any) => ({
    guild_id: guildId, // Legacy column (NOT NULL constraint)
    current_guild_id: guildId, // Current guild ID
    idlemmo_id: m.name.toLowerCase(), // Unique identifier
    ign: m.name, // In-game name
    position: m.position, // LEADER, OFFICER, etc.
    total_level: m.total_level, // Total level
    avatar_url: m.avatar_url, // Avatar URL
    is_active: true, // Mark as active
    synced_at: new Date().toISOString(), // Timestamp
  }));

  console.log("UPSERT PAYLOAD:", members);

  const { error: upsertError } = await supabase
    .from('members')
    .upsert(members, { onConflict: 'idlemmo_id' });

  console.log("UPSERT ERROR:", upsertError);

  if (upsertError) {
    console.log("❌ Upsert failed");
    return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }

  // Mark members who are no longer in the guild as inactive
  const syncedIds = members.map((m: { idlemmo_id: string }) => m.idlemmo_id);
  const { error: deactivateError } = await supabase
    .from('members')
    .update({ is_active: false })
    .eq('current_guild_id', guildId)
    .not('idlemmo_id', 'in', `(${syncedIds.map((id: string) => `"${id}"`).join(',')})`);

  if (deactivateError) {
    console.log("⚠️ Warning: Failed to deactivate old members:", deactivateError);
    // Don't fail the whole sync, just log the warning
  } else {
    console.log("✅ Deactivated members who left the guild");
  }

  console.log(`✅ SYNC COMPLETE — ${members.length} members synced`);
  console.log("=== SYNC MEMBERS END ===");

  return NextResponse.json({ success: true, synced: members.length });
}
