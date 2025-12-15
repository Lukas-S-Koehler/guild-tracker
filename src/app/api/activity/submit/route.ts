// app/api/activity/submit/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase';
import type { ProcessedMember } from '@/types';

export async function POST(req: NextRequest) {
  const supabase = createClient();
  try {
    const body = await req.json();
    const { log_date, members, logged_by } = body as { log_date?: string; members?: ProcessedMember[]; logged_by?: string };

    if (!log_date) return NextResponse.json({ error: 'log_date is required' }, { status: 400 });
    if (!Array.isArray(members) || members.length === 0) return NextResponse.json({ error: 'members array is required' }, { status: 400 });

    // 1) get guild config
    const { data: cfg, error: cfgErr } = await supabase.from('guild_config').select('guild_id').limit(1).single();
    if (cfgErr || !cfg?.guild_id) return NextResponse.json({ error: 'Guild not configured' }, { status: 400 });
    const guildId = cfg.guild_id;

    // 2) resolve IGNs -> member_id
    const igns = Array.from(new Set(members.map(m => m.ign.trim()).filter(Boolean)));
    const { data: memberRows, error: memberErr } = await supabase.from('members').select('id, ign').in('ign', igns);
    if (memberErr) { console.error(memberErr); return NextResponse.json({ error: 'Failed to lookup members' }, { status: 500 }); }
    const ignToId: Record<string, string> = {};
    (memberRows || []).forEach((r: any) => { if (r.ign) ignToId[r.ign] = r.id; });
    const missing = igns.filter(i => !ignToId[i]);
    if (missing.length > 0) return NextResponse.json({ error: 'Missing members', missing }, { status: 400 });

    // 3) prepare daily_logs payloads
    const dailyPayloads: any[] = [];
    const donationsGroups: { member_id: string; donations: any[] }[] = [];

    for (const m of members) {
      const memberId = ignToId[m.ign];
      const raids = Number(m.raids || 0);
      const goldDonated = Number(m.gold || 0);
      dailyPayloads.push({
        member_id: memberId,
        log_date,
        raids,
        gold_donated: goldDonated,
        challenge_contribution_percent: 0,
        met_requirement: false,
        logged_by: logged_by || null,
        guild_id: guildId,
      });
      donationsGroups.push({
        member_id: memberId,
        donations: (m.donations || []).map(d => ({
          item_name: d.item,
          quantity: Number(d.quantity || 0),
          unit_price: Number(d.price || 0),
          gold_value: Number(d.total || 0),
        })),
      });
    }

    // 4) insert daily_logs and get inserted rows
    const { data: insertedDailyLogs, error: insertDailyErr } = await supabase.from('daily_logs').insert(dailyPayloads).select('id, member_id, gold_donated');
    if (insertDailyErr) { console.error(insertDailyErr); return NextResponse.json({ error: 'Failed to insert daily logs' }, { status: 500 }); }

    // map member_id -> daily_log_id
    const memberToDailyLogId: Record<string, string> = {};
    (insertedDailyLogs || []).forEach((r: any) => { memberToDailyLogId[r.member_id] = r.id; });

    // 5) build donationsToInsert
    const donationsToInsert: any[] = [];
    for (const g of donationsGroups) {
      const dailyLogId = memberToDailyLogId[g.member_id];
      if (!dailyLogId) continue;
      for (const d of g.donations) {
        donationsToInsert.push({
          daily_log_id: dailyLogId,
          member_id: g.member_id,
          donated_at: new Date().toISOString(),
          gold_value: d.gold_value,
          quantity: d.quantity,
          unit_price: d.unit_price,
          item_name: d.item_name,
          item_id: null,
        });
      }
    }

    if (donationsToInsert.length > 0) {
      const { error: insertDonErr } = await supabase.from('donations').insert(donationsToInsert);
      if (insertDonErr) { console.error(insertDonErr); return NextResponse.json({ error: 'Failed to insert donations' }, { status: 500 }); }
    }

    // 6) compute per-item totals and per-member item aggregates (lowercase item_name)
    const itemTotals: Record<string, { totalQty: number; totalGold: number }> = {};
    for (const d of donationsToInsert) {
      const name = (d.item_name || '').toLowerCase();
      if (!name) continue;
      if (!itemTotals[name]) itemTotals[name] = { totalQty: 0, totalGold: 0 };
      itemTotals[name].totalQty += Number(d.quantity || 0);
      itemTotals[name].totalGold += Number(d.gold_value || 0);
    }

    const memberItemAgg: Record<string, Record<string, { qty: number; gold: number }>> = {};
    for (const d of donationsToInsert) {
      const memberId = d.member_id;
      const name = (d.item_name || '').toLowerCase();
      if (!memberItemAgg[memberId]) memberItemAgg[memberId] = {};
      if (!memberItemAgg[memberId][name]) memberItemAgg[memberId][name] = { qty: 0, gold: 0 };
      memberItemAgg[memberId][name].qty += Number(d.quantity || 0);
      memberItemAgg[memberId][name].gold += Number(d.gold_value || 0);
    }

    // 7) determine met_requirement per member (>=50% of any item by qty or gold)
    const memberMet: Record<string, boolean> = {};
    for (const memberId of Object.keys(memberItemAgg)) {
      memberMet[memberId] = false;
      for (const itemName of Object.keys(memberItemAgg[memberId])) {
        const mAgg = memberItemAgg[memberId][itemName];
        const totals = itemTotals[itemName];
        if (!totals) continue;
        const qtyPercent = totals.totalQty > 0 ? mAgg.qty / totals.totalQty : 0;
        const goldPercent = totals.totalGold > 0 ? mAgg.gold / totals.totalGold : 0;
        if (qtyPercent >= 0.5 || goldPercent >= 0.5) { memberMet[memberId] = true; break; }
      }
    }

    // 8) compute total gold and prepare challenge_contributions + daily_logs updates
    const totalGoldAll = (insertedDailyLogs || []).reduce((s: number, r: any) => s + Number(r.gold_donated || 0), 0);
    const challengeContribs: any[] = [];
    const dailyUpdates: { id: string; challenge_contribution_percent: number; met_requirement: boolean }[] = [];

    for (const r of insertedDailyLogs) {
      const percent = totalGoldAll > 0 ? (Number(r.gold_donated || 0) / totalGoldAll) * 100 : 0;
      challengeContribs.push({ challenge_id: null, member_id: r.member_id, gold_contributed: Number(r.gold_donated || 0), percentage: percent });
      dailyUpdates.push({ id: r.id, challenge_contribution_percent: percent, met_requirement: !!memberMet[r.member_id] });
    }

    // 9) update daily_logs rows (small loop; for many rows convert to single SQL update or RPC)
    for (const u of dailyUpdates) {
      await supabase.from('daily_logs').update({ challenge_contribution_percent: u.challenge_contribution_percent, met_requirement: u.met_requirement }).eq('id', u.id);
    }

    // 10) insert challenge_contributions (optional)
    if (challengeContribs.length > 0) {
      const { error: insertContribErr } = await supabase.from('challenge_contributions').insert(challengeContribs);
      if (insertContribErr) console.warn('challenge_contributions insert error', insertContribErr);
    }

    return NextResponse.json({ success: true, saved_daily_logs: insertedDailyLogs.length, saved_donations: donationsToInsert.length, total_gold: totalGoldAll });
  } catch (err: any) {
    console.error('activity submit error', err);
    return NextResponse.json({ error: err?.message || 'Failed to save activity' }, { status: 500 });
  }
}
