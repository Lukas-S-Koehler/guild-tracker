import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { verifySuperAdmin, isErrorResponse, SUPER_ADMIN_EMAIL } from '@/lib/auth-helpers';
import { IdleMMOApi } from '@/lib/idlemmo-api';

const SUPER_ADMIN_USER_ID = '5f33bb41-86ab-4024-a1da-6a2fea5fb36b';

// POST /api/admin/backfill-hashed-ids
// Populates members.hashed_id using:
// 1. Stored activity events (fast, no API calls)
// 2. Live IdleMMO API guild members endpoint (if available)
// 3. Live guild activity pages (fallback for remaining members)
export async function POST(req: NextRequest) {
  const auth = await verifySuperAdmin(req);
  if (isErrorResponse(auth)) return auth;

  const supabase = createAdminClient();

  // Get super admin's API key
  const { data: keyRow } = await supabase
    .from('user_api_keys')
    .select('api_key')
    .eq('user_id', SUPER_ADMIN_USER_ID)
    .single();

  const apiKey = keyRow?.api_key;
  const api = apiKey ? new IdleMMOApi(apiKey) : null;

  // === Step 1: Build name→hashed_id map from stored events ===
  const nameToHashedId = new Map<string, string>();

  const { data: events } = await supabase
    .from('guild_activity_events')
    .select('character_name, character_hashed_id')
    .not('character_hashed_id', 'is', null)
    .not('character_name', 'is', null);

  for (const e of events ?? []) {
    if (e.character_name && e.character_hashed_id) {
      nameToHashedId.set(e.character_name.toLowerCase(), e.character_hashed_id);
    }
  }

  // === Step 2: Live API — guild members + activity for each guild ===
  const liveStats: Record<string, { members_found: number; activity_pages: number }> = {};

  if (api) {
    const { data: guilds } = await supabase
      .from('guilds')
      .select('id, name')
      .eq('is_active', true);

    for (const guild of guilds ?? []) {
      const stat = { members_found: 0, activity_pages: 0 };

      // Try guild members endpoint first
      try {
        const guildMembers = await api.getAllGuildMembers(guild.id);
        for (const m of guildMembers) {
          if (m.name && m.hashed_id) {
            nameToHashedId.set(m.name.toLowerCase(), m.hashed_id);
            stat.members_found++;
          }
        }
      } catch {
        // endpoint may not exist, fall through to activity
      }

      // Fetch activity pages to catch anyone not in members list
      try {
        const actMap = await api.buildHashedIdMapFromActivity(guild.id, 30);
        actMap.forEach((hid, name) => {
          if (!nameToHashedId.has(name)) {
            nameToHashedId.set(name, hid);
            stat.activity_pages++;
          }
        });
      } catch {
        // ignore
      }

      liveStats[guild.id] = stat;
      await new Promise(r => setTimeout(r, 300));
    }
  }

  // === Step 3: Match members without hashed_id ===
  const { data: members } = await supabase
    .from('members')
    .select('id, ign, idlemmo_id')
    .is('hashed_id', null);

  let updated = 0;
  const stillMissing: string[] = [];
  const errors: string[] = [];

  for (const member of members ?? []) {
    const key = (member.idlemmo_id ?? member.ign ?? '').toLowerCase();
    const hashedId = nameToHashedId.get(key);

    if (!hashedId) {
      stillMissing.push(member.ign);
      continue;
    }

    const { error: updateError } = await supabase
      .from('members')
      .update({ hashed_id: hashedId })
      .eq('id', member.id);

    if (updateError) {
      errors.push(`${member.ign}: ${updateError.message}`);
    } else {
      updated++;
    }
  }

  return NextResponse.json({
    total_members_without_hashed_id: members?.length ?? 0,
    unique_names_in_map: nameToHashedId.size,
    updated,
    still_missing: stillMissing.length,
    still_missing_names: stillMissing.slice(0, 50),
    errors,
    used_api: !!api,
  });
}
