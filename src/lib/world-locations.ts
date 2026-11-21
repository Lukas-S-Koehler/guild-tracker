import { createAdminClient } from '@/lib/supabase-server';
import { IdleMMOApi, type WorldLocation, type WorldWeather } from '@/lib/idlemmo-api';

export async function syncWorldLocations(api: IdleMMOApi): Promise<number> {
  const res = await api.getWorldLocations();
  const rows = (res.locations ?? []).map((l) => ({
    id: l.id,
    key: l.key,
    name: l.name,
    description: l.description,
    image_url: l.image_url,
    x: l.x,
    y: l.y,
    forecast: l.forecast ?? [],
    updated_at: new Date().toISOString(),
  }));
  if (rows.length === 0) return 0;
  const supabase = createAdminClient();
  const { error } = await supabase.from('world_locations').upsert(rows, { onConflict: 'id' });
  if (error) throw new Error(error.message);
  return rows.length;
}

export interface LocationMeta {
  id: number;
  key: string;
  name: string;
  description: string | null;
  image_url: string | null;
  weather: { name: string; icon: string; buffs: string[]; ends_at: string } | null;
}

function currentWeather(forecast: WorldLocation['forecast'] | null, now = Date.now()): LocationMeta['weather'] {
  for (const day of forecast ?? []) {
    for (const w of day.weathers ?? []) {
      if (new Date(w.starts_at).getTime() <= now && now < new Date(w.ends_at).getTime()) {
        const ww = w as WorldWeather;
        return { name: ww.name, icon: ww.icon, buffs: ww.buffs ?? [], ends_at: ww.ends_at };
      }
    }
  }
  return null;
}

/** Location metadata (image, description, current weather) keyed by location id. */
export async function getLocationMeta(): Promise<Map<number, LocationMeta>> {
  const supabase = createAdminClient();
  const { data } = await supabase.from('world_locations').select('id, key, name, description, image_url, forecast');
  const map = new Map<number, LocationMeta>();
  for (const r of (data ?? []) as Array<Omit<LocationMeta, 'weather'> & { forecast: WorldLocation['forecast'] }>) {
    map.set(r.id, { id: r.id, key: r.key, name: r.name, description: r.description, image_url: r.image_url, weather: currentWeather(r.forecast) });
  }
  return map;
}
