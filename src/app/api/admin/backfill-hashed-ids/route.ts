import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { verifySuperAdminOrRole, isErrorResponse } from '@/lib/auth-helpers';

// POST /api/admin/backfill-hashed-ids
// Populates members.hashed_id from guild_activity_events character_hashed_id
export async function POST(req: NextRequest) {
  const auth = await verifySuperAdminOrRole(req, 'LEADER');
  if (isErrorResponse(auth)) return auth;

  const supabase = createAdminClient();

  // Get distinct character_name → character_hashed_id from activity events
  const { data: events, error } = await supabase
    .from('guild_activity_events')
    .select('character_name, character_hashed_id')
    .not('character_hashed_id', 'is', null)
    .not('character_name', 'is', null);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Build map: lowercase name → hashed_id (last seen wins)
  const nameToHashedId = new Map<string, string>();
  for (const e of events ?? []) {
    if (e.character_name && e.character_hashed_id) {
      nameToHashedId.set(e.character_name.toLowerCase(), e.character_hashed_id);
    }
  }

  // Fetch all members without hashed_id
  const { data: members } = await supabase
    .from('members')
    .select('id, ign, idlemmo_id')
    .is('hashed_id', null);

  let updated = 0;
  const errors: string[] = [];

  for (const member of members ?? []) {
    const key = (member.idlemmo_id ?? member.ign ?? '').toLowerCase();
    const hashedId = nameToHashedId.get(key);

    if (!hashedId) continue;

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
    total_members: members?.length ?? 0,
    unique_names_in_events: nameToHashedId.size,
    updated,
    errors,
  });
}
