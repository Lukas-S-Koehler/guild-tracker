import { IdleMMOApi } from '@/lib/idlemmo-api';

const IDLEMMO_BASE_URL = 'https://api.idle-mmo.com';

interface ItemDetailsResponse {
  item?: {
    hashed_id?: string;
    name?: string;
    effects?: Array<{ duration_seconds?: number; duration?: number }>;
    duration_seconds?: number;
    meta?: { duration_seconds?: number };
  };
}

/**
 * Best-effort fetch of potion duration from IdleMMO.
 * Falls back to null when the endpoint shape changes or item not found.
 */
export async function fetchPotionDurationMinutes(
  api: IdleMMOApi,
  hashedId: string,
): Promise<number | null> {
  const apiKey = (api as unknown as { apiKey: string }).apiKey;
  try {
    const res = await fetch(`${IDLEMMO_BASE_URL}/v1/item/${hashedId}`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'GuildTracker/1.0',
      },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as ItemDetailsResponse;
    const item = data.item ?? (data as unknown as ItemDetailsResponse['item']);
    const candidates = [
      item?.duration_seconds,
      item?.meta?.duration_seconds,
      ...(item?.effects ?? []).map((e) => e.duration_seconds ?? e.duration),
    ].filter((n): n is number => typeof n === 'number' && n > 0);
    if (candidates.length === 0) return null;
    const secs = Math.max(...candidates);
    return Math.round(secs / 60);
  } catch {
    return null;
  }
}
