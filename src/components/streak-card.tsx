'use client';

import { useState } from 'react';
import { Flame } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

type Streak = { current: number; best: number };
const days = (n: number) => `day${n === 1 ? '' : 's'}`;

/** Streak card: whole account by default, per character as the second view (one character = no toggle). */
export function StreakCard({ account, characters }: { account: Streak; characters: ({ member_id: string; ign: string } & Streak)[] }) {
  const [view, setView] = useState<'account' | 'character'>('account');
  const multi = characters.length > 1;
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Flame className="h-4 w-4 text-orange-400" />
            Streak
          </CardTitle>
          {multi && (
            <Tabs value={view} onValueChange={(v) => setView(v as 'account' | 'character')}>
              <TabsList className="h-8">
                <TabsTrigger value="account" className="px-2 text-xs">Account</TabsTrigger>
                <TabsTrigger value="character" className="px-2 text-xs">Character</TabsTrigger>
              </TabsList>
            </Tabs>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {view === 'account' || !multi ? (
          <div>
            <div className="text-4xl font-bold tabular-nums">
              {account.current}
              <span className="text-base font-normal text-muted-foreground"> {days(account.current)}</span>
            </div>
            <div className="text-sm text-muted-foreground">Best: {account.best} {days(account.best)}</div>
            <p className="mt-2 text-xs text-muted-foreground">
              {multi ? 'Any character meeting the requirement counts. ' : ''}Holidays and days the check missed pause it.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {characters.map((c) => (
              <li key={c.member_id} className="flex items-baseline justify-between gap-3">
                <span className="truncate font-medium">{c.ign}</span>
                <span className="shrink-0 tabular-nums">
                  <span className="text-lg font-bold">{c.current}</span>
                  <span className="text-xs text-muted-foreground"> {days(c.current)} · best {c.best}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
