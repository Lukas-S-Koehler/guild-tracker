// Backfill members.class from IdleMMO API.
// Run: SUPABASE_SERVICE_ROLE_KEY=... node scripts/backfill-member-classes.mjs [--all]
// --all: refresh even members whose class is already set.
// API key pulled from guild_config.api_key per member's current guild.

const SUPABASE_URL = 'https://twdgajldsmmmliehjxxp.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const REFRESH_ALL = process.argv.includes('--all');

if (!SERVICE_KEY) { console.error('Set SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }

const sbHeaders = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
};

async function sbGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, { headers: sbHeaders });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

async function sbPatch(path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method: 'PATCH',
    headers: { ...sbHeaders, Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH ${res.status} ${await res.text()}`);
}

async function fetchClass(hashedId, apiKey, retries = 3) {
  const url = `https://api.idle-mmo.com/v1/character/${hashedId}/characters`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': 'GuildTracker/1.0',
    },
    cache: 'no-store',
  });
  if (res.status === 429 && retries > 0) {
    const retryAfter = parseInt(res.headers.get('retry-after') || '5', 10);
    await new Promise(r => setTimeout(r, retryAfter * 1000));
    return fetchClass(hashedId, apiKey, retries - 1);
  }
  if (!res.ok) throw new Error(`IdleMMO ${res.status}`);
  const data = await res.json();
  const chars = data.characters ?? [];
  const self = chars.find((c) => c.hashed_id === hashedId);
  return self?.class ?? chars[0]?.class ?? null;
}

async function main() {
  const configs = await sbGet('/guild_config?select=guild_id,api_key');
  const keyByGuild = new Map();
  for (const c of configs) if (c.api_key) keyByGuild.set(String(c.guild_id), c.api_key);
  console.log(`Loaded API keys for ${keyByGuild.size} guilds`);

  const filter = REFRESH_ALL
    ? '?select=id,ign,hashed_id,current_guild_id&hashed_id=not.is.null&is_active=eq.true'
    : '?select=id,ign,hashed_id,current_guild_id&hashed_id=not.is.null&is_active=eq.true&class=is.null';
  const members = await sbGet(`/members${filter}`);
  console.log(`Backfilling class for ${members.length} members`);

  let ok = 0, fail = 0, skip = 0;
  for (const m of members) {
    const apiKey = keyByGuild.get(String(m.current_guild_id));
    if (!apiKey) {
      skip++;
      console.log(`- ${m.ign} (no api_key for guild ${m.current_guild_id})`);
      continue;
    }
    try {
      const cls = await fetchClass(m.hashed_id, apiKey);
      if (cls) {
        await sbPatch(`/members?id=eq.${m.id}`, { class: cls });
        ok++;
        console.log(`✓ ${m.ign} → ${cls}`);
      } else {
        console.log(`- ${m.ign} (no class)`);
      }
    } catch (err) {
      fail++;
      console.error(`✗ ${m.ign}: ${err.message}`);
    }
    await new Promise(r => setTimeout(r, 3100));
  }
  console.log(`Done. ok=${ok} fail=${fail} skip=${skip}`);
}

main().catch(err => { console.error(err); process.exit(1); });
