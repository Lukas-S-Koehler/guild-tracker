// Dev check: eligibility path (rubrics → buildRosterRow per guild) must match buildRoster for roster members.
// Run: npx tsx --env-file=.env.local scripts/check-eligibility-rows.ts
import { createAdminClient } from '../src/lib/supabase-server';
import { buildRoster, buildRosterRow, loadRowCatalog, loadRowMembers, zoneSlice, type RosterSnapshot } from '../src/lib/assault-roster';
import { loadRubrics, verdictOf, closestGuild } from '../src/lib/assault-eligibility';

async function main() {
  const supabase = createAdminClient();
  const catalog = await loadRowCatalog(supabase);
  const rubrics = await loadRubrics(supabase, catalog.zones);
  console.log('rubrics', rubrics.map((g) => `${g.name} @ ${g.zoneName}`).join(' | '));
  let same = 0, diff = 0;
  for (const g of rubrics) {
    const roster = await buildRoster(g.id, supabase);
    const { data: snaps } = await supabase.from('assault_roster').select('*').eq('guild_id', g.id);
    const list = (snaps ?? []) as RosterSnapshot[];
    const members = await loadRowMembers(supabase, list.map((s) => s.member_id), list.map((s) => s.hashed_id));
    for (const s of list) {
      const results = rubrics.map((rg) => {
        const row = buildRosterRow(s, { ...catalog, ...members, ...zoneSlice(catalog, rg.zoneId, rg.goals), answers: new Map() });
        return { guild: rg, row, verdict: verdictOf(row, rg.goals, rg.zoneName) };
      });
      const mine = results.find((x) => x.guild.id === g.id)!.row;
      const ref = roster!.rows.find((r) => r.member_id === s.member_id)!;
      const strip = (r: typeof ref) => JSON.stringify({ ...r, rsvp: null });
      if (strip(mine) === strip(ref)) same++; else diff++;
      if (s === list[0]) {
        console.log(s.ign, results.map((x) => `${x.guild.nickname ?? x.guild.name}: meets=${x.verdict.meets} below=${x.verdict.below} moves=${x.verdict.moves.join(' / ')}`).join('\n   '), '\n   closest', closestGuild(results));
      }
    }
  }
  console.log({ same, diff });
}
main().catch((e) => { console.error(e); process.exit(1); });
