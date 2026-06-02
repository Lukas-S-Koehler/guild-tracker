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
    return NextResponse.json(entries.map((e) => ({ ...e, alt_count: 0, alt_igns: [] })));
  }

  const memberIds = entries.map((e) => e.id);
  if (memberIds.length === 0) return NextResponse.json([]);

  // Fetch alt links for members in result set
  const { data: altLinks } = await supabase
    .from('member_alts')
    .select('member_id, alt_member_id, alt_ign, alt_hashed_id')
    .in('member_id', memberIds);

  // Fetch character_id for all members (lowest = main account)
  const { data: memberCharIds } = await supabase
    .from('members')
    .select('id, character_id')
    .in('id', memberIds);

  const charIdMap = new Map<string, number>(
    (memberCharIds ?? [])
      .filter((m) => m.character_id != null)
      .map((m) => [m.id, m.character_id as number])
  );

  // Union-find: group alts together
  const parent = new Map<string, string>();

  function find(id: string): string {
    if (!parent.has(id)) parent.set(id, id);
    const p = parent.get(id)!;
    if (p === id) return id;
    const root = find(p);
    parent.set(id, root);
    return root;
  }

  function union(a: string, b: string) {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    // Canonical = member with lower character_id (= main account)
    // Fall back to string sort if character_id unknown
    const charA = charIdMap.get(ra) ?? Infinity;
    const charB = charIdMap.get(rb) ?? Infinity;
    if (charA <= charB) parent.set(rb, ra);
    else parent.set(ra, rb);
  }

  for (const link of altLinks ?? []) {
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

  // Build merged entries: main = member with lowest character_id in group
  const merged_entries = Array.from(groups.values()).map((group) => {
    // Sort by character_id ascending (main first), fall back to activity_score desc
    group.sort((a, b) => {
      const cA = charIdMap.get(a.id) ?? Infinity;
      const cB = charIdMap.get(b.id) ?? Infinity;
      if (cA !== cB) return cA - cB;
      return b.activity_score - a.activity_score;
    });
    const main = group[0];
    const alts = group.slice(1);

    // Named alts: untracked chars linked from any member in this group
    // Deduplicate by alt_hashed_id to avoid counting same char multiple times
    const seenHashedIds = new Set<string>(group.map((e) => e.id)); // not needed but guard
    const namedAltsMap = new Map<string, string>(); // hashed_id → ign

    for (const link of altLinks ?? []) {
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
