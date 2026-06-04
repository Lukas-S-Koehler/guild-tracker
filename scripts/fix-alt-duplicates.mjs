// One-shot cleanup: merge duplicate account families in member_alts.
// Run: node scripts/fix-alt-duplicates.mjs

const SUPABASE_URL = 'https://twdgajldsmmmliehjxxp.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_KEY) {
  console.error('Set SUPABASE_SERVICE_ROLE_KEY env var');
  process.exit(1);
}

const headers = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
};

async function query(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, { headers, ...opts });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

async function del(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method: 'DELETE',
    headers: { ...headers, Prefer: 'return=minimal' },
  });
  if (!res.ok) throw new Error(`DELETE ${res.status} ${await res.text()}`);
}

async function post(path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${res.status} ${await res.text()}`);
}

// ---------- main ----------

console.log('Fetching member_alts...');
const rows = await query('/member_alts?select=id,member_id,alt_ign,alt_hashed_id,alt_character_id,alt_member_id&order=member_id');
console.log(`  ${rows.length} rows total`);

// Build alt_hashed_id → Set<member_id> index
const altToMains = new Map(); // alt_hashed_id → Set of member_ids that list it
for (const row of rows) {
  if (!row.alt_hashed_id) continue;
  if (!altToMains.has(row.alt_hashed_id)) altToMains.set(row.alt_hashed_id, new Set());
  altToMains.get(row.alt_hashed_id).add(row.member_id);
}

// Union-find to group member_ids that share any alt_hashed_id
const parent = new Map();
function find(id) {
  if (!parent.has(id)) parent.set(id, id);
  const p = parent.get(id);
  if (p === id) return id;
  const root = find(p);
  parent.set(id, root);
  return root;
}
function union(a, b) {
  const ra = find(a), rb = find(b);
  if (ra !== rb) parent.set(rb, ra);
}

for (const memberIds of altToMains.values()) {
  const arr = [...memberIds];
  for (let i = 1; i < arr.length; i++) union(arr[0], arr[i]);
}

// Also: if member A lists member B as alt_member_id → same account
for (const row of rows) {
  if (row.alt_member_id) union(row.member_id, row.alt_member_id);
}

// Group rows by canonical root
const familyRows = new Map(); // root → rows[]
for (const row of rows) {
  const root = find(row.member_id);
  if (!familyRows.has(root)) familyRows.set(root, []);
  familyRows.get(root).push(row);
}

// Find duplicate families (multiple member_ids share same root)
let fixed = 0;
for (const [root, familyData] of familyRows) {
  const memberIds = [...new Set(familyData.map(r => r.member_id))];
  if (memberIds.length === 1) continue; // no dup

  console.log(`\nFamily: ${memberIds.length} member_ids → [${memberIds.join(', ')}]`);

  // Pick canonical: prefer the member_id that is NOT listed as alt_member_id anywhere
  // (meaning no other member claimed it as their alt — it's more "main-like")
  const altMemberIds = new Set(rows.filter(r => r.alt_member_id).map(r => r.alt_member_id));
  const notAlt = memberIds.filter(id => !altMemberIds.has(id));

  // canonical = first non-alt, else first member_id alphabetically
  const canonical = notAlt.length > 0
    ? notAlt.sort()[0]
    : memberIds.sort()[0];

  console.log(`  Canonical: ${canonical}`);
  console.log(`  Others (will be removed as main): ${memberIds.filter(id => id !== canonical).join(', ')}`);

  // Collect union of all alt rows, dedup by alt_hashed_id (prefer rows from canonical)
  const altMap = new Map(); // alt_hashed_id → row
  // Add non-canonical rows first, then overwrite with canonical (canonical takes precedence)
  for (const row of familyData) {
    if (row.member_id !== canonical && row.alt_hashed_id) {
      if (!altMap.has(row.alt_hashed_id)) altMap.set(row.alt_hashed_id, row);
    }
  }
  for (const row of familyData) {
    if (row.member_id === canonical && row.alt_hashed_id) {
      altMap.set(row.alt_hashed_id, row); // overwrite
    }
  }

  // canonical itself shouldn't appear as its own alt
  altMap.delete(/* canonical's hashed_id — we don't have it here, handled by row filter */
    [...altMap.keys()].find(k => {
      const r = altMap.get(k);
      return r.alt_member_id === canonical;
    }) ?? '__noop__'
  );

  const freshAlts = [...altMap.values()].filter(r => r.alt_member_id !== canonical);

  console.log(`  Alts to write: ${freshAlts.map(r => r.alt_ign).join(', ')}`);

  // Delete ALL rows for ALL member_ids in family (forward + reverse)
  const idList = memberIds.map(id => `"${id}"`).join(',');
  await del(`/member_alts?member_id=in.(${idList})`);
  await del(`/member_alts?alt_member_id=in.(${idList})`);
  console.log(`  Deleted all rows for family`);

  // Rewrite under canonical
  for (const alt of freshAlts) {
    await post('/member_alts', {
      member_id: canonical,
      alt_ign: alt.alt_ign,
      alt_hashed_id: alt.alt_hashed_id,
      alt_character_id: alt.alt_character_id,
      alt_member_id: alt.alt_member_id === canonical ? null : alt.alt_member_id,
      fetched_at: new Date().toISOString(),
    });
  }
  console.log(`  Wrote ${freshAlts.length} rows under canonical`);
  fixed++;
}

console.log(`\nDone. Fixed ${fixed} duplicate families.`);

// Verify
const finalRows = await query('/member_alts?select=member_id,alt_hashed_id');
const seen = new Map();
let dupes = 0;
for (const r of finalRows) {
  const k = `${r.member_id}::${r.alt_hashed_id}`;
  seen.set(k, (seen.get(k) ?? 0) + 1);
}
for (const [k, count] of seen) {
  if (count > 1) { console.log(`DUPE: ${k} ×${count}`); dupes++; }
}
console.log(`Final: ${finalRows.length} rows, ${dupes} duplicate pairs.`);
