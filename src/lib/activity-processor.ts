import { SupabaseClient } from '@supabase/supabase-js';
import { IdleMMOApi, ActivityEvent } from './idlemmo-api';

interface DayMemberActivity {
  raids: number;
  donations: Array<{ item: string; quantity: number }>;
  deposits: Array<{ item: string; quantity: number }>;
  logOrder: number;
}

// Determine if an event type relates to raids
function isRaidEvent(type: string, text: string): boolean {
  const t = type.toUpperCase();
  if (t.includes('RAID') || t.includes('PARTICIPATED')) return true;
  const l = text.toLowerCase();
  return l.includes('participated in a raid') || l.includes('completed a raid');
}

// Determine if an event type is a challenge contribution (gold donation)
function isDonationEvent(type: string, text: string): boolean {
  const t = type.toUpperCase();
  if (t.includes('CONTRIBUTED') || t.includes('DONATED') || t.includes('DONATION')) return true;
  return text.toLowerCase().includes('contributed');
}

function eventDateUTC(createdAt: string): string {
  const d = new Date(createdAt);
  d.setUTCMinutes(d.getUTCMinutes() - 710); // shift day boundary to 11:50 UTC
  return d.toISOString().substring(0, 10);
}

export async function processActivityEvents(
  events: ActivityEvent[],
  guildId: string,
  supabase: SupabaseClient,
  apiKey?: string
): Promise<{ processed: number; membersHandled: number; joins: string[]; leaves: string[] }> {
  if (events.length === 0) return { processed: 0, membersHandled: 0, joins: [], leaves: [] };

  // Build hashed_id map from event data — free, no extra API calls
  const hashedIdMap = new Map<string, string>(); // lowercased name → hashed_id
  for (const event of events) {
    if (event.character?.name && event.character?.hashed_id) {
      hashedIdMap.set(event.character.name.toLowerCase(), event.character.hashed_id);
    }
  }

  // Group events by date → character → activity
  const byDateChar: Record<string, Record<string, DayMemberActivity>> = {};
  const joins: string[] = [];
  const leaves: string[] = [];
  let eventOrder = 0;

  for (const event of [...events].reverse()) { // reverse so oldest first = lower log_order
    const date = eventDateUTC(event.created_at);
    const name = event.character?.name;

    if (!name) {
      // Guild-level event (no character)
      if (event.type === 'JOINED_GUILD' && event.character?.name) {
        joins.push(event.character.name);
      }
      continue;
    }

    if (event.type === 'JOINED_GUILD') {
      joins.push(name);
      continue;
    }

    if (event.type === 'LEFT_GUILD' || event.type === 'KICKED_FROM_GUILD' || event.type === 'KICKED') {
      leaves.push(name);
      continue;
    }

    if (!byDateChar[date]) byDateChar[date] = {};
    if (!byDateChar[date][name]) {
      byDateChar[date][name] = { raids: 0, donations: [], deposits: [], logOrder: eventOrder++ };
    }

    const activity = byDateChar[date][name];

    if (event.type === 'DEPOSITED_STOCKPILE') {
      if (event.item && event.value) {
        activity.deposits.push({ item: event.item.name, quantity: event.value });
      }
    } else if (isRaidEvent(event.type, event.text)) {
      activity.raids += 1;
    } else if (isDonationEvent(event.type, event.text)) {
      if (event.item && event.value) {
        activity.donations.push({ item: event.item.name, quantity: event.value });
      }
    }
  }

  // Collect all unique item names for price lookup
  const allItems = new Set<string>();
  for (const dateData of Object.values(byDateChar)) {
    for (const memberData of Object.values(dateData)) {
      memberData.donations.forEach(d => allItems.add(d.item.toLowerCase()));
      memberData.deposits.forEach(d => allItems.add(d.item.toLowerCase()));
    }
  }

  // Build price map: check cache first, then API
  const priceMap: Record<string, number> = {};

  if (allItems.size > 0) {
    const itemList = Array.from(allItems);
    const { data: cached } = await supabase
      .from('market_cache')
      .select('item_name, price')
      .in('item_name', itemList);

    cached?.forEach((c: any) => {
      priceMap[c.item_name.toLowerCase()] = c.price;
    });

    const uncached = itemList.filter(item => priceMap[item] === undefined);

    if (uncached.length > 0 && apiKey) {
      const api = new IdleMMOApi(apiKey);
      for (const itemName of uncached) {
        try {
          const { price, itemId } = await api.getItemPrice(itemName);
          priceMap[itemName] = price ?? 0;
          if (price > 0) {
            await supabase.from('market_cache').upsert({
              item_name: itemName,
              item_id: itemId,
              price,
              cached_at: new Date().toISOString(),
            }, { onConflict: 'item_name' });
          }
        } catch {
          priceMap[itemName] = 0;
        }
        // 3.1s between items: each item = 2 API calls, keeps total under 20 req/min
        await new Promise(r => setTimeout(r, 3100));
      }
    }
  }

  // Fetch guild config for donation requirement
  const { data: config } = await supabase
    .from('guild_config')
    .select('settings')
    .eq('guild_id', guildId)
    .single();

  const donationReq = config?.settings?.donation_requirement ?? 5000;

  // Fetch active buildings for valid deposit items
  const activeBuildings: string[] = config?.settings?.active_buildings || [];
  const validDepositItems = new Set<string>();

  if (activeBuildings.length > 0) {
    const { data: buildings } = await supabase
      .from('guild_buildings')
      .select('id, name, resources')
      .in('id', activeBuildings);

    buildings?.forEach((b: any) => {
      if (Array.isArray(b.resources)) {
        b.resources.forEach((r: any) => {
          if (r.item) validDepositItems.add(r.item.toLowerCase());
        });
      }
    });
  }

  let processed = 0;
  let membersHandled = 0;

  for (const [date, charMap] of Object.entries(byDateChar)) {
    for (const [charName, activity] of Object.entries(charMap)) {
      const ignLower = charName.toLowerCase();

      // Find or create member
      let { data: member } = await supabase
        .from('members')
        .select('id, current_guild_id')
        .eq('idlemmo_id', ignLower)
        .maybeSingle();

      const hashedId = hashedIdMap.get(ignLower);

      if (!member) {
        const { data: inserted } = await supabase
          .from('members')
          .insert({
            ign: charName,
            idlemmo_id: ignLower,
            guild_id: guildId,
            current_guild_id: guildId,
            position: 'RECRUIT',
            is_active: true,
            first_seen: date,
            last_seen: date,
            total_level: 0,
            avatar_url: null,
            ...(hashedId ? { hashed_id: hashedId } : {}),
          })
          .select('id, current_guild_id')
          .single();
        member = inserted;
      } else {
        await supabase
          .from('members')
          .update({
            last_seen: date,
            is_active: true,
            ...(hashedId ? { hashed_id: hashedId } : {}),
          })
          .eq('id', member.id);
      }

      if (!member) continue;
      membersHandled++;

      // Calculate gold values
      let donationGold = 0;
      const donationRows: Array<{ item: string; qty: number; price: number; total: number }> = [];

      for (const d of activity.donations) {
        const price = priceMap[d.item.toLowerCase()] ?? 0;
        const total = price * d.quantity;
        donationGold += total;
        donationRows.push({ item: d.item, qty: d.quantity, price, total });
      }

      let depositGold = 0;
      const depositRows: Array<{ item: string; qty: number; price: number; total: number; valid: boolean }> = [];

      for (const d of activity.deposits) {
        const price = priceMap[d.item.toLowerCase()] ?? 0;
        const total = price * d.quantity;
        const valid = validDepositItems.size === 0 || validDepositItems.has(d.item.toLowerCase());
        if (valid) depositGold += total;
        depositRows.push({ item: d.item, qty: d.quantity, price, total, valid });
      }

      const totalGold = donationGold + depositGold;
      const metRequirement = totalGold >= donationReq;

      // Upsert daily_log
      const { data: logRow, error: logError } = await supabase
        .from('daily_logs')
        .upsert({
          member_id: member.id,
          guild_id: guildId,
          log_date: date,
          raids: activity.raids,
          gold_donated: donationGold,
          deposits_gold: depositGold,
          met_requirement: metRequirement,
          log_order: activity.logOrder,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'member_id,log_date' })
        .select('id')
        .single();

      if (logError || !logRow) continue;

      // Upsert donations
      for (const row of donationRows) {
        await supabase.from('donations').upsert({
          daily_log_id: logRow.id,
          member_id: member.id,
          guild_id: guildId,
          item_name: row.item,
          quantity: row.qty,
          unit_price: row.price,
          gold_value: row.total,
        }, { onConflict: 'daily_log_id,item_name' });
      }

      // Upsert deposits into donations table with a deposit flag
      for (const row of depositRows) {
        if (!row.valid) continue;
        await supabase.from('donations').upsert({
          daily_log_id: logRow.id,
          member_id: member.id,
          guild_id: guildId,
          item_name: `[DEPOSIT] ${row.item}`,
          quantity: row.qty,
          unit_price: row.price,
          gold_value: row.total,
        }, { onConflict: 'daily_log_id,item_name' });
      }

      processed++;
    }
  }

  // Handle join events: update first_seen
  for (const name of joins) {
    const ignLower = name.toLowerCase();
    const today = new Date().toISOString().substring(0, 10);
    const { data: m } = await supabase
      .from('members')
      .select('id')
      .eq('idlemmo_id', ignLower)
      .maybeSingle();

    if (m) {
      await supabase
        .from('members')
        .update({ first_seen: today, current_guild_id: guildId, is_active: true })
        .eq('id', m.id);
    }
  }

  // Handle leave events: mark inactive
  for (const name of leaves) {
    const ignLower = name.toLowerCase();
    const { data: m } = await supabase
      .from('members')
      .select('id')
      .eq('idlemmo_id', ignLower)
      .maybeSingle();

    if (m) {
      await supabase
        .from('members')
        .update({ is_active: false })
        .eq('id', m.id);
    }
  }

  return { processed, membersHandled, joins, leaves };
}

export async function storeActivityEvents(
  events: ActivityEvent[],
  guildId: string,
  supabase: SupabaseClient
): Promise<number> {
  if (events.length === 0) return 0;

  const rows = events.map(e => ({
    id: e.id,
    guild_id: guildId,
    type: e.type,
    character_hashed_id: e.character?.hashed_id ?? null,
    character_name: e.character?.name ?? null,
    character_avatar_url: e.character?.avatar_url ?? null,
    event_text: e.text,
    value: e.value ?? null,
    item_hashed_id: e.item?.hashed_id ?? null,
    item_name: e.item?.name ?? null,
    item_image_url: e.item?.image_url ?? null,
    item_quality: e.item?.quality ?? null,
    guild_item_id: e.guild_item?.id ?? null,
    guild_item_key: e.guild_item?.key ?? null,
    guild_item_name: e.guild_item?.name ?? null,
    guild_item_image_url: e.guild_item?.image_url ?? null,
    created_at: e.created_at,
  }));

  // Upsert in batches to avoid request size limits
  const BATCH = 100;
  let stored = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await supabase
      .from('guild_activity_events')
      .upsert(batch, { onConflict: 'id,guild_id' });
    if (!error) stored += batch.length;
  }

  return stored;
}
