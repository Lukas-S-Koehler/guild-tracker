import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { sharedXpEffect } from '@/lib/potion-rules';
import { deleteOwnerLoadout, listOwnerLoadouts, ownerForUser, saveOwnerLoadout } from '@/lib/potions-service';

export const dynamic = 'force-dynamic';

async function getUser(req: NextRequest) {
  const supabase = createServerClient(req);
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}

// Web and Discord (/potions) loadouts are one set per person once Discord is linked:
// see LoadoutOwner in potions-service. Writes go through the admin client because
// Discord-made rows may not carry user_id yet (RLS would hide them).

export async function GET(req: NextRequest) {
  const { user } = await getUser(req);
  if (!user) return NextResponse.json({ loadouts: [] });
  const loadouts = await listOwnerLoadouts(await ownerForUser(user.id));
  return NextResponse.json({ loadouts });
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
  // Same-effect XP potions (hunting efficiency) can't be combined even across slots.
  if (body.xp_potion_ids.length > 1) {
    const { data: xpRows } = await supabase
      .from('xp_potions')
      .select('id, name, efficiency_value')
      .in('id', body.xp_potion_ids);
    const rows = xpRows ?? [];
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const effect = sharedXpEffect(rows[i], rows[j]);
        if (effect) {
          return NextResponse.json({ error: `${rows[i].name} and ${rows[j].name} both give ${effect} — pick one.` }, { status: 400 });
        }
      }
    }
  }
  try {
    const loadout = await saveOwnerLoadout(await ownerForUser(user.id), {
      id: body.id,
      name: body.name,
      is_default: !!body.is_default,
      combat_potion_ids: body.combat_potion_ids,
      xp_potion_ids: body.xp_potion_ids,
    });
    return NextResponse.json({ loadout });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const { user } = await getUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  try {
    await deleteOwnerLoadout(await ownerForUser(user.id), id);
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
