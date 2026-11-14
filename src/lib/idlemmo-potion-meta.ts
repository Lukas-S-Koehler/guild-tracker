import { IdleMMOApi } from '@/lib/idlemmo-api';

const IDLEMMO_BASE_URL = 'https://api.idle-mmo.com';

export interface PotionEffect {
  value: number;
  length: number; // milliseconds
  target: string;
  attribute: string;
  value_type: string;
}

export interface InspectItem {
  hashed_id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  type: string;
  quality: string;
  vendor_price: number;
  is_tradeable: boolean;
  effects: PotionEffect[] | null;
}

export interface PotionMetaResult {
  item: InspectItem | null;
  durationMinutes: number | null;
  source: string;
  rawSample?: unknown;
}

const CANDIDATE_PATHS = (hash: string) => [
  `/v1/item/${hash}`,
  `/v1/item/${hash}/inspect`,
  `/v1/item/inspect/${hash}`,
];

function extractDurationMinutes(item: InspectItem | null): number | null {
  if (!item?.effects?.length) return null;
  const lengths = item.effects.map((e) => e.length).filter((n) => typeof n === 'number' && n > 0);
  if (lengths.length === 0) return null;
  return Math.round(Math.max(...lengths) / 60_000);
}

export async function fetchPotionMeta(
  api: IdleMMOApi,
  hashedId: string,
): Promise<PotionMetaResult> {
  const apiKey = (api as unknown as { apiKey: string }).apiKey;
  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'User-Agent': 'GuildTracker/1.0',
  };
  let lastRaw: unknown = null;
  for (const path of CANDIDATE_PATHS(hashedId)) {
    try {
      const res = await fetch(`${IDLEMMO_BASE_URL}${path}`, { headers, cache: 'no-store' });
      if (!res.ok) continue;
      const data = (await res.json()) as { item?: InspectItem };
      lastRaw = data;
      const item = data.item ?? null;
      if (!item) continue;
      const mins = extractDurationMinutes(item);
      return { item, durationMinutes: mins, source: path };
    } catch { /* try next */ }
  }
  return { item: null, durationMinutes: null, source: 'none', rawSample: lastRaw };
}

export async function searchItemHashedId(api: IdleMMOApi, name: string): Promise<string | null> {
  const apiKey = (api as unknown as { apiKey: string }).apiKey;
  const url = `${IDLEMMO_BASE_URL}/v1/item/search?query=${encodeURIComponent(name)}`;
  try {
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'GuildTracker/1.0',
      },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { items?: Array<{ name: string; hashed_id: string }> };
    const items = data.items ?? [];
    const exact = items.find((i) => i.name.toLowerCase() === name.toLowerCase());
    return (exact ?? items[0])?.hashed_id ?? null;
  } catch {
    return null;
  }
}
