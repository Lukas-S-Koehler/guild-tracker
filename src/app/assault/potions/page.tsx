import { listPotions } from '@/lib/potions-service';
import { PotionsClient } from './PotionsClient';

export const dynamic = 'force-dynamic';

export default async function AssaultPotionsPage() {
  const { combat, xp, presets } = await listPotions();
  return <PotionsClient combat={combat} xp={xp} presets={presets} />;
}
