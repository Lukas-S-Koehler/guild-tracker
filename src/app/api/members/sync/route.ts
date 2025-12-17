import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { verifyAuth, isErrorResponse } from '@/lib/auth-helpers';
import { getMemberApiKey } from '@/lib/member-api-key';

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

  if (!apiKey) {
    console.log("❌ No API key found for member");
    return NextResponse.json(
      { error: 'API key not configured. Go to Settings to add your IdleMMO API key.' },
      { status: 400 }
    );
  }

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

  const members = data.members.map((m: any) => ({
    current_guild_id: guildId,
    idlemmo_id: m.name.toLowerCase(),
    ign: m.name,
    position: m.position,
    total_level: m.total_level,
    avatar_url: m.avatar_url,
    is_active: true,
    synced_at: new Date().toISOString(),
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

  console.log(`✅ SYNC COMPLETE — ${members.length} members synced`);
  console.log("=== SYNC MEMBERS END ===");

  return NextResponse.json({ success: true, synced: members.length });
}
