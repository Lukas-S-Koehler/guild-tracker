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

interface MarketListing {
  price_per_item: number;
}

interface MarketSale {
  price_per_item: number;
}

interface HistoryData {
  average_price: number;
}

interface MarketHistoryResponse {
  current_listings?: MarketListing[];
  latest_sold?: MarketSale[];
  history_data?: HistoryData[];
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
      const marketUrl = `${IDLEMMO_BASE_URL}/v1/item/${hashedId}/market-history?tier=0&type=listings`;
      const marketData = await this.fetch<MarketHistoryResponse>(marketUrl);

      let price = vendorPrice;

      // Use current market listings (most accurate)
      if (marketData.current_listings && marketData.current_listings.length > 0) {
        const listingPrices = marketData.current_listings.map(l => l.price_per_item);
        price = Math.min(...listingPrices);
      }
      // Fall back to recent sales average
      else if (marketData.latest_sold && marketData.latest_sold.length > 0) {
        const recentPrices = marketData.latest_sold.map(s => s.price_per_item);
        price = Math.round(recentPrices.reduce((a, b) => a + b, 0) / recentPrices.length);
      }
      // Fall back to historical average
      else if (marketData.history_data && marketData.history_data.length > 0) {
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
}
