'use client';

import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';

/** "You're in this guild" shortcut: switches the current guild and opens the dashboard. */
export default function MemberShortcut({ guildId }: { guildId: string }) {
  const { user, guilds, myGuildIds, setCurrentGuild } = useAuth();
  const router = useRouter();
  const membership = guilds.find((g) => g.guild_id === guildId);
  if (!user || !membership || !myGuildIds.has(guildId)) return null;
  return (
    <Button size="sm" onClick={() => { setCurrentGuild(membership); router.push('/'); }}>
      You&apos;re in this guild · open dashboard
    </Button>
  );
}
