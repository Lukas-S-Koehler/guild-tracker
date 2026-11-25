// Dev check: dumps buildRoster rows for every assault guild (generatedAt stripped) as JSON.
// Used to verify refactors don't change roster output. Run: npx tsx --env-file=.env.local scripts/dump-roster.ts > out.json
import { createAdminClient } from '../src/lib/supabase-server';
import { buildRoster } from '../src/lib/assault-roster';

async function main() {
  const supabase = createAdminClient();
  const { data: guilds } = await supabase.from('guilds').select('id, name').eq('is_assault', true).order('name');
  const out: Record<string, unknown> = {};
  for (const g of guilds ?? []) {
    const r = await buildRoster(String(g.id), supabase);
    if (r) out[g.name as string] = { ...r, generatedAt: undefined };
  }
  process.stdout.write(JSON.stringify(out, null, 1));
}
main().catch((e) => { console.error(e); process.exit(1); });
