const IDLEMMO_BASE_URL = 'https://api.idle-mmo.com';

export interface ActivityEventCharacter {
  hashed_id: string;
  name: string;
  avatar_url: string | null;
}

export interface ActivityEventItem {
  hashed_id: string;
  name: string;
  image_url: string | null;
  quality: string;
}

export interface ActivityEventGuildItem {
  id: number;
  key: string;
  name: string;
  image_url: string | null;
}

export interface ActivityEvent {
  id: number;
  type: string;
  character: ActivityEventCharacter | null;
  text: string;
  value: number | null;
  item: ActivityEventItem | null;
  guild_item: ActivityEventGuildItem | null;
  created_at: string;
  created_ago: string;
}

interface GuildActivityResponse {
  guild: { id: number; name: string };
  activity: ActivityEvent[];
  pagination: { current_page: number; has_more: boolean; next_page: number | null };
  endpoint_updates_at: string;
}

interface SearchItem {
  hashed_id: string;
  name: string;
  vendor_price: number;
}

interface MarketSale {
  price_per_item: number;
  quantity: number;
  tier: number;
  sold_at: string;
}

interface HistoryData {
  date: string;
  average_price: number;
  total_sold: number;
}

interface MarketHistoryResponse {
  latest_sold?: MarketSale[];
  history_data?: HistoryData[];
}

function weightedMedian(samples: Array<{ price: number; weight: number }>): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a.price - b.price);
  const total = sorted.reduce((s, x) => s + x.weight, 0);
  if (total <= 0) return sorted[Math.floor(sorted.length / 2)].price;
  const half = total / 2;
  let acc = 0;
  for (const s of sorted) {
    acc += s.weight;
    if (acc >= half) return s.price;
  }
  return sorted[sorted.length - 1].price;
}

interface AltCharacterResponse {
  characters: Array<{
    id: number;
    hashed_id: string;
    name: string;
    class: string;
    total_level: number;
    created_at: string;
  }>;
  endpoint_updates_at: string;
}

export interface GuildMember {
  hashed_id: string;
  name: string;
  rank?: string;
  total_level?: number;
  joined_at?: string;
}

interface GuildMembersResponse {
  members: GuildMember[];
  pagination?: { current_page: number; has_more: boolean; next_page: number | null };
}

export interface GuildHallRequirement {
  item: { id: number; name: string; image_url: string | null };
  quantity: { needed: number; current: number | null };
}

export interface GuildHallBlueprint {
  id: number;
  key: string;
  name: string;
  type: string;
  level_needed: number | null;
  is_available: boolean;
  image_url: string | null;
  description: string;
  cost: number;
  length: { raw: number; readable: string };
  requirements: GuildHallRequirement[];
  is_replacement: boolean;
  replaces_blueprint_id: number | null;
  benefits: string[];
}

export interface GuildHallUpgrade {
  id: number;
  status: { key: string; readable: string };
  ends_at: string | null;
  ends_in: number | null;
  repair: {
    condition_percentage: string;
    can_repair: boolean;
    blueprint: GuildHallBlueprint;
  } | null;
  available_upgrade: GuildHallBlueprint | null;
  blueprint: GuildHallBlueprint;
}

export interface GuildHallResponse {
  guild_hall: {
    id: number | null;
    name: string;
    location: { id: number | null; name: string | null };
    slots: { total: number | null; free: number | null; occupied: number | null; remaining: number };
    upgrades: GuildHallUpgrade[];
    blueprints: GuildHallBlueprint[];
  };
  endpoint_updates_at: string;
}

export class IdleMMOApi {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async fetch<T>(url: string, retries = 3): Promise<T> {
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'GuildTracker/1.0',
      },
      cache: 'no-store',
    });

    if (res.status === 429 && retries > 0) {
      const retryAfter = parseInt(res.headers.get('retry-after') || '5', 10);
      await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
      return this.fetch<T>(url, retries - 1);
    }

    if (!res.ok) {
      throw new Error(`API Error: ${res.status} ${res.statusText}`);
    }

    return res.json();
  }

  async getItemPrice(itemName: string): Promise<{ price: number; itemId: string | null }> {
    try {
      // Step 1: Search for item
      const searchUrl = `${IDLEMMO_BASE_URL}/v1/item/search?query=${encodeURIComponent(itemName)}`;
      const searchData = await this.fetch<{ items: SearchItem[] }>(searchUrl);

      if (!searchData.items || searchData.items.length === 0) {
        return { price: 0, itemId: null };
      }

      // Prioritize exact match (case-insensitive)
      let item = searchData.items.find(
        i => i.name.toLowerCase() === itemName.toLowerCase()
      );
      if (!item) {
        item = searchData.items[0];
      }

      const hashedId = item.hashed_id;
      const vendorPrice = item.vendor_price || 0;

      // Step 2: Get market history
      const marketUrl = `${IDLEMMO_BASE_URL}/v1/item/${hashedId}/market-history?tier=0&type=orders`;
      const marketData = await this.fetch<MarketHistoryResponse>(marketUrl);

      let price = vendorPrice;

      const sales = marketData.latest_sold ?? [];

      if (sales.length > 0) {
        const samples = sales.map(s => ({
          price: s.price_per_item,
          weight: Math.max(1, s.quantity ?? 1),
        }));
        price = weightedMedian(samples);
      } else if (marketData.history_data && marketData.history_data.length > 0) {
        const latestData = marketData.history_data[marketData.history_data.length - 1];
        price = latestData.average_price || vendorPrice;
      }

      return { price, itemId: hashedId };
    } catch (error) {
      console.error(`Error fetching price for "${itemName}":`, error);
      return { price: 0, itemId: null };
    }
  }

  async getItemPrices(itemNames: string[]): Promise<Record<string, number>> {
    const prices: Record<string, number> = {};

    for (const itemName of itemNames) {
      const { price } = await this.getItemPrice(itemName);
      prices[itemName] = price;
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return prices;
  }

  async getGuildActivity(guildId: string, page = 1): Promise<GuildActivityResponse> {
    const url = `${IDLEMMO_BASE_URL}/v1/guild/${guildId}/activity?page=${page}`;
    return this.fetch<GuildActivityResponse>(url);
  }

  async getCharacterAlts(hashedCharId: string): Promise<AltCharacterResponse['characters']> {
    const url = `${IDLEMMO_BASE_URL}/v1/character/${hashedCharId}/characters`;
    const data = await this.fetch<AltCharacterResponse>(url);
    return data.characters ?? [];
  }

  async getCharacterClass(hashedCharId: string): Promise<string | null> {
    const chars = await this.getCharacterAlts(hashedCharId);
    const self = chars.find((c) => c.hashed_id === hashedCharId);
    return self?.class ?? chars[0]?.class ?? null;
  }

  async getGuildMembers(guildId: string, page = 1): Promise<GuildMembersResponse> {
    const url = `${IDLEMMO_BASE_URL}/v1/guild/${guildId}/members?page=${page}`;
    return this.fetch<GuildMembersResponse>(url);
  }

  async getAllGuildMembers(guildId: string): Promise<GuildMember[]> {
    const all: GuildMember[] = [];
    let page = 1;
    while (true) {
      try {
        const res = await this.getGuildMembers(guildId, page);
        const members = res.members ?? [];
        all.push(...members);
        if (!res.pagination?.has_more || members.length === 0) break;
        page++;
        await new Promise(r => setTimeout(r, 500));
      } catch {
        break;
      }
    }
    return all;
  }

  // Builds name→hashed_id map by fetching all activity pages for a guild
  async buildHashedIdMapFromActivity(guildId: string, maxPages = 50): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    for (let page = 1; page <= maxPages; page++) {
      try {
        const res = await this.getGuildActivity(guildId, page);
        for (const e of res.activity ?? []) {
          if (e.character?.name && e.character?.hashed_id) {
            map.set(e.character.name.toLowerCase(), e.character.hashed_id);
          }
        }
        if (!res.pagination?.has_more) break;
        await new Promise(r => setTimeout(r, 500));
      } catch {
        break;
      }
    }
    return map;
  }

  async getAllGuildActivitySince(guildId: string, sinceDate: Date): Promise<ActivityEvent[]> {
    const allEvents: ActivityEvent[] = [];
    let page = 1;

    while (true) {
      const response = await this.getGuildActivity(guildId, page);
      const events = response.activity;

      if (!events || events.length === 0) break;

      let reachedCutoff = false;
      for (const event of events) {
        const eventDate = new Date(event.created_at);
        if (eventDate < sinceDate) {
          reachedCutoff = true;
          break;
        }
        allEvents.push(event);
      }

      if (reachedCutoff || !response.pagination.has_more) break;

      page++;
      // 3.1s between pages keeps under 20 req/min rate limit
      await new Promise(resolve => setTimeout(resolve, 3100));
    }

    return allEvents;
  }

  async getGuildHall(guildId: string): Promise<GuildHallResponse> {
    return this.fetch<GuildHallResponse>(`${IDLEMMO_BASE_URL}/v1/guild/${guildId}/hall`);
  }

  async getEnergizingPool(guildId: string): Promise<EnergizingPoolResponse> {
    return this.fetch<EnergizingPoolResponse>(
      `${IDLEMMO_BASE_URL}/v1/guild/${guildId}/energizing-pool/information`
    );
  }
}

export interface EnergizingPoolResponse {
  guild: { id: number; name: string };
  energizing_pool: {
    id: number | null;
    status: 'DORMANT' | 'ACTIVE_BUT_NOT_APPLIED' | 'ACTIVE_AND_APPLIED';
    ends_at: string | null;
    effects: string[];
  };
  endpoint_updates_at: string;
}
