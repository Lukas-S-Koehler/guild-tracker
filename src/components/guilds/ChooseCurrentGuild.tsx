'use client';

import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

/** Only shows for a signed-in user with guild access but no selected guild (ProtectedRoute sends them here). */
export default function ChooseCurrentGuild() {
  const { user, loading, guilds, currentGuild, setCurrentGuild } = useAuth();
  const router = useRouter();
  if (loading || !user || currentGuild || guilds.length === 0) return null;
  return (
    <Card className="border-amber-500/40">
      <CardContent className="p-4 space-y-2">
        <p className="text-sm font-medium">Pick which of your guilds to view</p>
        <div className="flex flex-wrap gap-2">
          {guilds.map((g) => (
            <Button key={g.guild_id} variant="outline" size="sm" onClick={() => { setCurrentGuild(g); router.push('/'); }}>
              {g.guild_name}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
