// app/api/members/list/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { verifyAuthOrPublic, verifySuperAdminOrRole, isErrorResponse } from '@/lib/auth-helpers';

// GET /api/members/list — public, no auth required
export async function GET(req: NextRequest) {
  const authResult = await verifyAuthOrPublic(req);
  if (isErrorResponse(authResult)) return authResult;
  const { guildId } = authResult;

  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('members')
    .select(`
      *,
      guild:guilds!current_guild_id (
        id,
        name,
        nickname
      )
    `)
    .eq('current_guild_id', guildId)
    .eq('is_active', true)
    .order('position', { ascending: true })
    .order('total_level', { ascending: false });

  if (error) {
    console.error('LIST MEMBERS ERROR:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

// PATCH /api/members/list?member_id=... — update discord mapping fields
export async function PATCH(req: NextRequest) {
  const auth = await verifySuperAdminOrRole(req, 'OFFICER');
  if (isErrorResponse(auth)) return auth;

  const supabase = createAdminClient();
  const { searchParams } = new URL(req.url);
  const memberId = searchParams.get('member_id');

  if (!memberId) return NextResponse.json({ error: 'member_id required' }, { status: 400 });

  const body = await req.json();
  const update: Record<string, string | null> = {};
  if ('discord_id' in body) update.discord_id = body.discord_id;
  if ('discord_username' in body) update.discord_username = body.discord_username;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  const force = searchParams.get('force') === 'true';

  const { error } = await supabase.from('members').update(update).eq('id', memberId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Propagate discord info to all alt-linked members (main, siblings, own alts)
  if (update.discord_id !== undefined) {
    const [{ data: fwdLinks }, { data: revLinks }] = await Promise.all([
      supabase.from('member_alts').select('alt_member_id').eq('member_id', memberId).not('alt_member_id', 'is', null),
      supabase.from('member_alts').select('member_id').eq('alt_member_id', memberId),
    ]);

    const linkedIds = new Set<string>([
      ...(fwdLinks ?? []).map((r) => r.alt_member_id).filter(Boolean) as string[],
      ...(revLinks ?? []).map((r) => r.member_id).filter(Boolean) as string[],
    ]);

    // Siblings: if this member is an alt, get all other alts of the same main
    const parentIds = (revLinks ?? []).map((r) => r.member_id).filter(Boolean) as string[];
    if (parentIds.length > 0) {
      const { data: siblingLinks } = await supabase
        .from('member_alts')
        .select('alt_member_id')
        .in('member_id', parentIds)
        .not('alt_member_id', 'is', null);
      for (const r of siblingLinks ?? []) {
        if (r.alt_member_id && r.alt_member_id !== memberId) linkedIds.add(r.alt_member_id);
      }
    }

    const allLinkedIds = Array.from(linkedIds);
    if (allLinkedIds.length > 0) {
      let q = supabase.from('members').update(update).in('id', allLinkedIds);
      if (!force) q = q.is('discord_id', null);
      await q;
    }
  }

  return NextResponse.json({ ok: true });
}
