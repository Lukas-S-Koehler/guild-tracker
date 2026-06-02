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

  // Merge alt characters: group entries by account via member_alts
  // Fetch alt links for all members in this result set
  const memberIds = entries.map((e) => e.id);
  if (memberIds.length === 0) return NextResponse.json([]);

  const { data: altLinks } = await supabase
    .from('member_alts')
    .select('member_id, alt_member_id, alt_ign')
    .in('member_id', memberIds);

  // Build union-find groups: canonically group alts together
  // member_id → canonical id (lowest in group)
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
    if (ra !== rb) {
      // smaller string wins as canonical
      if (ra < rb) parent.set(rb, ra);
      else parent.set(ra, rb);
    }
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

  // Build merged entries: canonical member is highest activity_score in group
  const merged_entries = Array.from(groups.values()).map((group) => {
    group.sort((a, b) => b.activity_score - a.activity_score);
    const main = group[0];
    const alts = group.slice(1);

    // Also include named alts from member_alts table that aren't tracked members
    const namedAlts = (altLinks ?? [])
      .filter((l) => find(l.member_id) === find(main.id) && !memberIds.includes(l.alt_member_id ?? ''))
      .map((l) => l.alt_ign);

    return {
      ...main,
      total_raids: group.reduce((s, e) => s + (e.total_raids ?? 0), 0),
      total_gold: group.reduce((s, e) => s + (e.total_gold ?? 0), 0),
      activity_score: group.reduce((s, e) => s + (e.activity_score ?? 0), 0),
      days_active: Math.max(...group.map((e) => e.days_active ?? 0)),
      alt_count: alts.length + namedAlts.length,
      alt_igns: [...alts.map((a) => a.ign), ...namedAlts],
    };
  });

  merged_entries.sort((a, b) => b.activity_score - a.activity_score);

  return NextResponse.json(merged_entries);
}
