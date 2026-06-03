import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';

// GET /api/leaderboard — public, no auth required
export async function GET(req: NextRequest) {
  const supabase = createAdminClient();
  const { searchParams } = new URL(req.url);

  const period = searchParams.get('period') || 'week';
  const guildFilter = searchParams.get('guild');
  const merged = searchParams.get('merged') !== 'false'; // default: merged=true

  let viewName: string;
  switch (period) {
    case 'week':
      viewName = 'v_weekly_leaderboard';
      break;
    case 'month':
      viewName = 'v_monthly_leaderboard';
      break;
    case 'all':
    default:
      viewName = 'v_global_leaderboard';
  }

  let query = supabase.from(viewName).select('*');
  if (guildFilter && guildFilter !== 'all') {
    query = query.eq('current_guild_id', guildFilter);
  }

  const { data: leaderboard, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const entries = leaderboard ?? [];

  if (!merged) {
    // In individual mode, still annotate which members are alts and who their main is
    const memberIds = entries.map((e) => e.id);
    if (memberIds.length === 0) return NextResponse.json(entries.map((e) => ({ ...e, alt_count: 0, alt_igns: [], is_alt: false, main_ign: null })));

    const { data: revLinks } = await supabase
      .from('member_alts')
      .select('member_id, alt_member_id')
      .in('alt_member_id', memberIds);

    // alt_member_id → main's member_id
    const altToMainId = new Map<string, string>();
    for (const link of revLinks ?? []) {
      if (link.alt_member_id) altToMainId.set(link.alt_member_id, link.member_id);
    }

    // Fetch main members' IGNs
    const mainIds = Array.from(new Set(Array.from(altToMainId.values())));
    let mainIgnMap = new Map<string, string>();
    if (mainIds.length > 0) {
      const { data: mainMembers } = await supabase
        .from('members')
        .select('id, ign')
        .in('id', mainIds);
      for (const m of mainMembers ?? []) mainIgnMap.set(m.id, m.ign);
      // Also check entries themselves (main may be in the same result set)
      for (const e of entries) mainIgnMap.set(e.id, e.ign);
    }

    return NextResponse.json(entries.map((e) => {
      const mainId = altToMainId.get(e.id);
      return {
        ...e,
        alt_count: 0,
        alt_igns: [],
        is_alt: !!mainId,
        main_ign: mainId ? (mainIgnMap.get(mainId) ?? null) : null,
      };
    }));
  }

  const memberIds = entries.map((e) => e.id);
  if (memberIds.length === 0) return NextResponse.json([]);

  // Fetch alt links: forward (member is main) + reverse (member is alt)
  // Reverse lookup needed when main is in a different guild and not in this result set
  const [{ data: altLinks }, { data: reverseAltLinks }] = await Promise.all([
    supabase
      .from('member_alts')
      .select('member_id, alt_member_id, alt_ign, alt_hashed_id')
      .in('member_id', memberIds),
    supabase
      .from('member_alts')
      .select('member_id, alt_member_id, alt_ign, alt_hashed_id')
      .in('alt_member_id', memberIds),
  ]);
  // External mains: member_id from reverseAltLinks not in this guild's memberIds.
  // Need their forward links to show untracked alts (e.g. JC001/JC002/JC003 under JCFighter).
  const externalMainIds = Array.from(new Set(
    (reverseAltLinks ?? [])
      .map((l) => l.member_id)
      .filter((id) => !memberIds.includes(id))
  ));

  let externalLinks: Array<{
    member_id: string;
    alt_member_id: string | null;
    alt_ign: string;
    alt_hashed_id: string | null;
  }> = [];

  if (externalMainIds.length > 0) {
    const { data } = await supabase
      .from('member_alts')
      .select('member_id, alt_member_id, alt_ign, alt_hashed_id')
      .in('member_id', externalMainIds);
    externalLinks = data ?? [];
  }

  const allLinks = [...(altLinks ?? []), ...(reverseAltLinks ?? []), ...externalLinks];

  // Union-find: group alts together
  // member_id in alt_links is always the main; alt_member_id is always the alt
  const parent = new Map<string, string>();

  function find(id: string): string {
    if (!parent.has(id)) parent.set(id, id);
    const p = parent.get(id)!;
    if (p === id) return id;
    const root = find(p);
    parent.set(id, root);
    return root;
  }

  function union(mainMemberId: string, altMemberId: string) {
    const rm = find(mainMemberId);
    const ra = find(altMemberId);
    if (rm === ra) return;
    parent.set(ra, rm); // main always becomes canonical root
  }

  for (const link of allLinks) {
    if (link.alt_member_id && memberIds.includes(link.alt_member_id)) {
      union(link.member_id, link.alt_member_id);
    }
  }

  // Group entries by canonical id
  const groups = new Map<string, typeof entries>();
  for (const entry of entries) {
    const canonical = find(entry.id);
    const group = groups.get(canonical) ?? [];
    group.push(entry);
    groups.set(canonical, group);
  }

  // Build merged entries: main = member whose id is the canonical root of its group
  const merged_entries = Array.from(groups.entries()).map(([canonicalId, group]) => {
    // canonical id IS the main member's id (set by union-find which always roots on member_id)
    const main = group.find((e) => e.id === canonicalId) ?? group[0];
    const alts = group.filter((e) => e.id !== main.id);

    // Named alts: untracked chars linked from any member in this group
    // Deduplicate by alt_hashed_id to avoid counting same char multiple times
    const namedAltsMap = new Map<string, string>(); // hashed_id → ign

    for (const link of allLinks) {
      if (find(link.member_id) !== find(main.id)) continue;
      if (memberIds.includes(link.alt_member_id ?? '')) continue; // tracked member, counted in alts[]
      if (link.alt_hashed_id) {
        namedAltsMap.set(link.alt_hashed_id, link.alt_ign);
      }
    }

    const namedAltIgns = Array.from(namedAltsMap.values());

    return {
      ...main,
      total_raids: group.reduce((s, e) => s + (e.total_raids ?? 0), 0),
      total_gold: group.reduce((s, e) => s + (e.total_gold ?? 0), 0),
      activity_score: group.reduce((s, e) => s + (e.activity_score ?? 0), 0),
      days_active: Math.max(...group.map((e) => e.days_active ?? 0)),
      alt_count: alts.length + namedAltIgns.length,
      alt_igns: [...alts.map((a) => a.ign), ...namedAltIgns],
    };
  });

  merged_entries.sort((a, b) => b.activity_score - a.activity_score);

  return NextResponse.json(merged_entries);
}
