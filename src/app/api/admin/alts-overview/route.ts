import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { verifySuperAdmin, isErrorResponse } from '@/lib/auth-helpers';

export const dynamic = 'force-dynamic';

// GET /api/admin/alts-overview
// Global view: tracked members + alt links across all guilds, grouped into accounts.
export async function GET(req: NextRequest) {
  const auth = await verifySuperAdmin(req);
  if (isErrorResponse(auth)) return auth;

  const supabase = createAdminClient();
  const [{ data: members }, { data: alts }, { data: guilds }] = await Promise.all([
    supabase.from('members').select('id, ign, hashed_id, current_guild_id, position, character_id, is_active').eq('is_active', true),
    supabase.from('member_alts').select('id, member_id, alt_ign, alt_hashed_id, alt_member_id, source, alt_character_id'),
    supabase.from('guilds').select('id, nickname, name'),
  ]);

  const memberById = new Map((members ?? []).map((m) => [m.id, m]));
  const guildById = new Map((guilds ?? []).map((g) => [g.id, g]));

  // Union-find over member ids using alt links
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    if (!parent.has(x)) parent.set(x, x);
    if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!));
    return parent.get(x)!;
  };
  const union = (a: string, b: string) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const m of members ?? []) find(m.id);
  for (const link of alts ?? []) {
    if (link.alt_member_id && memberById.has(link.member_id) && memberById.has(link.alt_member_id)) {
      union(link.member_id, link.alt_member_id);
    }
  }

  const accounts = new Map<string, { chars: Array<any>; links: Array<any> }>();
  for (const m of members ?? []) {
    const root = find(m.id);
    const acc = accounts.get(root) ?? { chars: [], links: [] };
    acc.chars.push({
      id: m.id,
      ign: m.ign,
      hashed_id: m.hashed_id,
      guild_id: m.current_guild_id,
      guild_nickname: m.current_guild_id ? guildById.get(m.current_guild_id)?.nickname ?? null : null,
      position: m.position,
      character_id: m.character_id,
    });
    accounts.set(root, acc);
  }
  for (const link of alts ?? []) {
    const anchor = memberById.has(link.member_id) ? find(link.member_id) : null;
    if (!anchor || !accounts.has(anchor)) continue;
    accounts.get(anchor)!.links.push(link);
  }

  const result = Array.from(accounts.values())
    .map((acc) => {
      acc.chars.sort((a, b) => (a.character_id ?? Infinity) - (b.character_id ?? Infinity));
      return acc;
    })
    .filter((acc) => acc.chars.length > 1 || acc.links.length > 0)
    .sort((a, b) => b.chars.length - a.chars.length);

  return NextResponse.json({
    accounts: result,
    totals: {
      tracked_members: members?.length ?? 0,
      accounts: result.length,
      manual_links: (alts ?? []).filter((l) => l.source === 'manual').length,
      sync_links: (alts ?? []).filter((l) => l.source !== 'manual').length,
    },
  });
}
