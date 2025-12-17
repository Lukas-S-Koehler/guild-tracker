import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

export async function POST(req: NextRequest) {
  console.log("=== SYNC MEMBERS START ===");

  const supabase = createServerClient(req);

  // Load config
  const { data: config, error: configError } = await supabase
    .from('guild_config')
    .select('guild_id, api_key')
    .limit(1)
    .single();

  console.log("CONFIG LOADED:", config);
  console.log("CONFIG ERROR:", configError);

  if (configError || !config?.guild_id || !config?.api_key) {
    console.log("❌ Missing config values");
    return NextResponse.json(
      { error: 'Missing guild ID or API key in config' },
      { status: 400 }
    );
  }

  const url = `https://api.idle-mmo.com/v1/guild/${config.guild_id}/members`;
  console.log("FETCHING FROM:", url);

  // Fetch members from IdleMMO
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${config.api_key}`,
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
    guild_id: config.guild_id,
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
    .upsert(members, { onConflict: 'guild_id,idlemmo_id' });

  console.log("UPSERT ERROR:", upsertError);

  if (upsertError) {
    console.log("❌ Upsert failed");
    return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }

  console.log(`✅ SYNC COMPLETE — ${members.length} members synced`);
  console.log("=== SYNC MEMBERS END ===");

  return NextResponse.json({ success: true, synced: members.length });
}
