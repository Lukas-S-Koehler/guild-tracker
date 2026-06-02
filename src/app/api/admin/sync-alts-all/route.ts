import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { verifySuperAdmin, isErrorResponse } from '@/lib/auth-helpers';
import { IdleMMOApi } from '@/lib/idlemmo-api';

const SUPER_ADMIN_USER_ID = '5f33bb41-86ab-4024-a1da-6a2fea5fb36b';

// POST /api/admin/sync-alts-all — sync alt characters for ALL guilds using super admin API key
export async function POST(req: NextRequest) {
  const auth = await verifySuperAdmin(req);
  if (isErrorResponse(auth)) return auth;

  const supabase = createAdminClient();

  const { data: keyRow } = await supabase
    .from('user_api_keys')
    .select('api_key')
    .eq('user_id', SUPER_ADMIN_USER_ID)
    .single();

  if (!keyRow?.api_key) {
    return NextResponse.json({ error: 'No API key found for super admin. Add your IdleMMO API key in your profile settings.' }, { status: 400 });
  }

  const api = new IdleMMOApi(keyRow.api_key);

  // All tracked members with hashed_id (for cross-referencing alt_member_id)
  const { data: allMembers, error: allMembersError } = await supabase
    .from('members')
    .select('id, ign, hashed_id, current_guild_id, character_id')
    .eq('is_active', true)
    .not('hashed_id', 'is', null);

  if (allMembersError) return NextResponse.json({ error: allMembersError.message }, { status: 500 });

  const hashedIdToMember = new Map(
    (allMembers ?? []).map((m) => [m.hashed_id, m])
  );

  // Active members in a guild — these we'll call the API for
  const activeMembers = (allMembers ?? []).filter((m) => m.current_guild_id != null);

  let processed = 0;
  const errors: string[] = [];

  // accountKey (min char_id string) → { chars, trackedMembers }
  type ApiChar = { id: number; hashed_id: string; name: string };
  type TrackedMember = typeof activeMembers[number] & { character_id: number | null };
  const accountGroups = new Map<string, { chars: ApiChar[]; trackedMembers: TrackedMember[] }>();

  // Phase 1: fetch API data, populate character_id, group by account
  for (const member of activeMembers) {
    if (!member.hashed_id) continue;
    try {
      const chars = await api.getCharacterAlts(member.hashed_id);
      processed++;

      // Update member's own character_id
      const selfChar = chars.find((c) => c.hashed_id === member.hashed_id);
      if (selfChar && member.character_id !== selfChar.id) {
        await supabase.from('members').update({ character_id: selfChar.id }).eq('id', member.id);
        member.character_id = selfChar.id;
      }

      // Account key = minimum character_id on the account (stable identifier for the account)
      const minId = chars.reduce((m, c) => Math.min(m, c.id), Infinity);
      const key = String(minId);

      if (!accountGroups.has(key)) {
        accountGroups.set(key, { chars, trackedMembers: [] });
      }
      const group = accountGroups.get(key)!;
      // Merge chars in case two tracked members on same account returned slightly different lists
      if (chars.length > group.chars.length) group.chars = chars;
      group.trackedMembers.push(member as TrackedMember);

      await new Promise((r) => setTimeout(r, 200));
    } catch (err) {
      errors.push(`${member.ign}: ${String(err)}`);
    }
  }

  // Phase 2: write clean, canonical alt links
  // Representative = tracked member with lowest character_id (= main account)
  let totalAltLinks = 0;

  for (const { chars, trackedMembers } of Array.from(accountGroups.values())) {
    // Sort tracked members: lowest character_id first = main
    trackedMembers.sort((a: TrackedMember, b: TrackedMember) => (a.character_id ?? 999999) - (b.character_id ?? 999999));
    const representative = trackedMembers[0];

    // Delete ALL existing alt links for every tracked member in this account group
    const groupMemberIds = trackedMembers.map((m: TrackedMember) => m.id);
    await supabase.from('member_alts').delete().in('member_id', groupMemberIds);

    // Insert fresh links ONLY from the representative (main account member)
    const otherChars = chars.filter((c: ApiChar) => c.hashed_id !== representative.hashed_id);
    totalAltLinks += otherChars.length;

    for (const char of otherChars) {
      const altMember = hashedIdToMember.get(char.hashed_id);
      await supabase.from('member_alts').insert({
        member_id: representative.id,
        alt_ign: char.name,
        alt_hashed_id: char.hashed_id,
        alt_character_id: char.id,
        alt_member_id: altMember?.id ?? null,
        fetched_at: new Date().toISOString(),
      });
    }
  }

  return NextResponse.json({
    total_members_with_hashed_id: activeMembers.length,
    processed,
    accounts_grouped: accountGroups.size,
    alt_links_written: totalAltLinks,
    error_count: errors.length,
    errors: errors.slice(0, 20),
  });
}
