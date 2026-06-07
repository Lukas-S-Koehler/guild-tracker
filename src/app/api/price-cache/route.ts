import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-server';
import { verifySuperAdmin, isErrorResponse } from '@/lib/auth-helpers';
import { IdleMMOApi } from '@/lib/idlemmo-api';

const SUPER_ADMIN_USER_ID = '5f33bb41-86ab-4024-a1da-6a2fea5fb36b';

async function getApiKey() {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('user_api_keys')
    .select('api_key')
    .eq('user_id', SUPER_ADMIN_USER_ID)
    .single();
  return data?.api_key ?? null;
}

// GET /api/price-cache — list all cached items, stalest first
export async function GET(req: NextRequest) {
  const auth = await verifySuperAdmin(req);
  if (isErrorResponse(auth)) return auth;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('market_cache')
    .select('item_name, item_id, price, cached_at')
    .order('cached_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ items: data ?? [] });
}

// POST /api/price-cache — sync one or all items
export async function POST(req: NextRequest) {
  const auth = await verifySuperAdmin(req);
  if (isErrorResponse(auth)) return auth;

  const body = await req.json();
  const apiKey = await getApiKey();

  if (!apiKey) {
    return NextResponse.json({ error: 'No API key configured for super admin.' }, { status: 400 });
  }

  const supabase = createAdminClient();
  const api = new IdleMMOApi(apiKey);

  if (body.sync_all) {
    const { data: allItems, error } = await supabase
      .from('market_cache')
      .select('item_name');

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const items = allItems ?? [];
    let updated = 0;
    const failed: string[] = [];

    for (const { item_name } of items) {
      try {
        const { price, itemId } = await api.getItemPrice(item_name);
        if (price > 0) {
          await supabase.from('market_cache').upsert({
            item_name,
            item_id: itemId ?? null,
            price,
            cached_at: new Date().toISOString(),
          }, { onConflict: 'item_name' });
          updated++;
        } else {
          failed.push(item_name);
        }
      } catch {
        failed.push(item_name);
      }
    }

    return NextResponse.json({ updated, failed });
  }

  if (body.item_name) {
    const item_name = (body.item_name as string).toLowerCase();
    try {
      const { price, itemId } = await api.getItemPrice(item_name);
      if (price > 0) {
        await supabase.from('market_cache').upsert({
          item_name,
          item_id: itemId ?? null,
          price,
          cached_at: new Date().toISOString(),
        }, { onConflict: 'item_name' });
        return NextResponse.json({ updated: 1, failed: [], item: { item_name, item_id: itemId, price, cached_at: new Date().toISOString() } });
      } else {
        return NextResponse.json({ updated: 0, failed: [item_name] });
      }
    } catch (err) {
      return NextResponse.json({ updated: 0, failed: [item_name], error: String(err) }, { status: 500 });
    }
  }

  return NextResponse.json({ error: 'Provide item_name or sync_all: true' }, { status: 400 });
}

// DELETE /api/price-cache — remove a single cache entry
export async function DELETE(req: NextRequest) {
  const auth = await verifySuperAdmin(req);
  if (isErrorResponse(auth)) return auth;

  const body = await req.json();
  if (!body.item_name) {
    return NextResponse.json({ error: 'item_name required' }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from('market_cache')
    .delete()
    .eq('item_name', (body.item_name as string).toLowerCase());

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ deleted: true });
}
