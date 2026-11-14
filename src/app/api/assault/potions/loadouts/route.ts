import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

async function getUser(req: NextRequest) {
  const supabase = createServerClient(req);
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function GET(req: NextRequest) {
  const { supabase, user } = await getUser(req);
  if (!user) return NextResponse.json({ loadouts: [] });
  const { data, error } = await supabase
    .from('assault_potion_loadouts')
    .select('*')
    .eq('user_id', user.id)
    .order('is_default', { ascending: false })
    .order('updated_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ loadouts: data ?? [] });
}

interface SaveBody {
  id?: string;
  name: string;
  is_default?: boolean;
  combat_potion_ids: number[];
  xp_potion_ids: number[];
}

export async function POST(req: NextRequest) {
  const { supabase, user } = await getUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = (await req.json()) as SaveBody;
  if (!body?.name || !Array.isArray(body.combat_potion_ids) || !Array.isArray(body.xp_potion_ids)) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  if (body.is_default) {
    await supabase
      .from('assault_potion_loadouts')
      .update({ is_default: false })
      .eq('user_id', user.id);
  }

  const payload = {
    user_id: user.id,
    name: body.name.slice(0, 80),
    is_default: !!body.is_default,
    combat_potion_ids: body.combat_potion_ids,
    xp_potion_ids: body.xp_potion_ids,
    updated_at: new Date().toISOString(),
  };

  if (body.id) {
    const { data, error } = await supabase
      .from('assault_potion_loadouts')
      .update(payload)
      .eq('id', body.id)
      .eq('user_id', user.id)
      .select('*')
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ loadout: data });
  }
  const { data, error } = await supabase
    .from('assault_potion_loadouts')
    .insert(payload)
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ loadout: data });
}

export async function DELETE(req: NextRequest) {
  const { supabase, user } = await getUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  const { error } = await supabase
    .from('assault_potion_loadouts')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
