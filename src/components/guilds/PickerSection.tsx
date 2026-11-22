'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Sparkles } from 'lucide-react';
import GuildFitPicker from '@/components/guilds/GuildFitPicker';
import type { DirectoryGuild } from '@/lib/guild-directory';

/**
 * Visitors and unassigned users get the "which guild fits me" picker open.
 * Members already in a Dream guild see their guilds instead; the picker folds away
 * (still handy for an alt or a move up).
 */
export default function PickerSection({ guilds }: { guilds: DirectoryGuild[] }) {
  const { user, loading, isAwaitingAssignment, myCharacters } = useAuth();
  const [open, setOpen] = useState(false);
  const mine = user && !isAwaitingAssignment
    ? myCharacters.filter((c) => c.in_dream_guild && c.guild_id && guilds.some((g) => g.id === c.guild_id))
    : [];

  if (loading) return null;
  if (mine.length === 0) return <GuildFitPicker guilds={guilds} />;

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-4 space-y-2">
          <p className="text-sm font-medium">Your guilds</p>
          <div className="flex flex-wrap gap-2">
            {mine.map((c) => {
              const g = guilds.find((x) => x.id === c.guild_id)!;
              return (
                <Link key={c.member_id} href={`/guilds/${g.tag.toLowerCase()}`} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
                  <span className="font-medium">{g.name}</span>
                  <span className="text-muted-foreground"> · {c.ign}{c.position ? ` (${c.position.charAt(0) + c.position.slice(1).toLowerCase()})` : ''}</span>
                </Link>
              );
            })}
          </div>
          {!open && (
            <Button variant="ghost" size="sm" className="px-0 text-sky-400 hover:text-sky-300 hover:bg-transparent" onClick={() => setOpen(true)}>
              <Sparkles className="h-3.5 w-3.5 mr-1.5" />Find a guild for an alt or a move up
            </Button>
          )}
        </CardContent>
      </Card>
      {open && <GuildFitPicker guilds={guilds} />}
    </div>
  );
}
