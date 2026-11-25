import { headers } from 'next/headers';
import { listPotions } from '@/lib/potions-service';
import { requireAccess } from '@/lib/access-server';
import { isResponse } from '@/lib/user-auth';
import { PotionsClient } from './PotionsClient';

export const dynamic = 'force-dynamic';

export default async function AssaultPotionsPage() {
  // Server-rendered data: check access here too (the layout's gate only hides it on the client).
  const gate = await requireAccess(new Request('http://local/assault/potions', { headers: { cookie: headers().get('cookie') ?? '' } }), 'assaulter');
  if (isResponse(gate)) return null;
  const { combat, xp, presets } = await listPotions();
  return <PotionsClient combat={combat} xp={xp} presets={presets} />;
}
