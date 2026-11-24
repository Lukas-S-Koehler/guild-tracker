import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { recomputeAllClaimedUsers } from '@/lib/account-service';
import { IdleMMOApi } from '@/lib/idlemmo-api';
import { detectJoins } from '@/lib/recruit-service';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** New members get their class here, a few per run (the guild members list has no class). */
const CLASS_FILL_PER_RUN = 15;

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
        .select('idlemmo_id, current_guild_id, first_seen, created_at, hashed_id')
        .in('idlemmo_id', memberIds);

      const existingMap = new Map<string, { current_guild_id: string | null; first_seen: string | null; created_at: string | null; hashed_id: string | null }>();
      existing?.forEach((m: any) => {
        existingMap.set(m.idlemmo_id, { current_guild_id: m.current_guild_id, first_seen: m.first_seen, created_at: m.created_at, hashed_id: m.hashed_id });
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
          // Always send first_seen/hashed_id: a bulk upsert fills keys missing from a row with NULL,
          // so conditional spreads wiped first_seen of existing members whenever a newcomer was synced.
          first_seen: isNewToGuild ? today : (ex?.first_seen ?? ex?.created_at?.slice(0, 10) ?? today),
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

  // Fill missing classes. /information is public, so any guild's key works.
  let classes_filled = 0;
  const anyKey = guilds.find((g) => g.api_key)?.api_key as string | undefined;
  if (anyKey) {
    const { data: missing } = await supabase
      .from('members')
      .select('id, hashed_id')
      .eq('is_active', true)
      .is('class', null)
      .not('hashed_id', 'is', null)
      .limit(CLASS_FILL_PER_RUN);
    const api = new IdleMMOApi(anyKey);
    for (const m of missing ?? []) {
      try {
        const cls = await api.getCharacterClass(m.hashed_id as string);
        if (cls) {
          await supabase.from('members').update({ class: cls }).eq('id', m.id);
          classes_filled++;
        }
      } catch (err) {
        console.warn('[members-sync-all] class fetch failed', m.id, err);
      }
    }
  }

  // Guild moves, promotions and leaves → update derived website access.
  let access: { users: number; changed: number } | { error: string };
  try {
    access = await recomputeAllClaimedUsers(supabase);
  } catch (err) {
    access = { error: String(err) };
  }

  // Recruits that showed up in a Dream guild → joined.
  let recruits_joined: number | { error: string };
  try {
    recruits_joined = await detectJoins(supabase);
  } catch (err) {
    recruits_joined = { error: String(err) };
  }

  return NextResponse.json({ success: true, results, classes_filled, access, recruits_joined });
}
