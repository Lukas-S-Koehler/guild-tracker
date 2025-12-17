'use client';

// Force dynamic rendering, disable all caching
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { formatGold, formatDate } from '@/lib/utils';
import { useApiClient } from '@/lib/api-client';

interface ChallengeItem {
  name: string;
  quantity: number;
  price: number;
  total: number;
  isExpensive: boolean;
}

interface SavedChallenge {
  id: string;
  challenge_date: string;
  total_cost: number;
  items: ChallengeItem[];
  created_at?: string;
}

export default function ChallengesListPage() {
  const [challenges, setChallenges] = useState<SavedChallenge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const api = useApiClient();

  useEffect(() => {
    loadChallenges();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadChallenges() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/api/challenges/list');
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || `Status ${res.status}`);
      }
      const data = await res.json();
      // Expect array sorted newest-first from API; if not, sort here by created_at
      const arr = Array.isArray(data) ? data : [];
      arr.sort((a: SavedChallenge, b: SavedChallenge) => {
        const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
        const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
        return tb - ta;
      });
      setChallenges(arr);
    } catch (err: any) {
      console.error('Failed to load challenges', err);
      setError(err?.message || 'Failed to load challenges');
      setChallenges([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">📚 Saved Challenges</h1>
          <p className="text-muted-foreground">All saved challenge runs for your guild</p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/challenges">New Challenge</Link>
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Challenges</CardTitle>
          <CardDescription>Newest first — full item lists shown</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm text-muted-foreground">Loading…</span>
            </div>
          ) : error ? (
            <div className="text-destructive">{error}</div>
          ) : challenges.length === 0 ? (
            <p className="text-sm text-muted-foreground">No challenges found.</p>
          ) : (
            <div className="space-y-4">
              {challenges.map((c) => (
                <article key={c.id} className="border rounded-lg p-4 shadow-sm">
                  <header className="flex items-start justify-between">
                    <div>
                      <h3 className="font-medium">{formatDate(new Date(c.challenge_date))}</h3>
                      <p className="text-xs text-muted-foreground">
                        {c.items?.length ?? 0} items • saved {c.created_at ? formatDate(new Date(c.created_at)) : ''}
                      </p>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold">{formatGold(c.total_cost)}</div>
                    </div>
                  </header>

                  <div className="mt-3 grid gap-2">
                    {c.items?.map((it, idx) => (
                      <div key={idx} className="flex items-center justify-between border-b py-2">
                        <div className="flex items-center gap-3">
                          <span className={it.isExpensive ? 'text-red-600 font-medium' : 'font-medium'}>
                            {it.name}
                          </span>
                          <span className="text-xs text-muted-foreground">x{it.quantity.toLocaleString()}</span>
                        </div>
                        <div className="text-right">
                          <div className="text-sm text-muted-foreground">{formatGold(it.price)} each</div>
                          <div className="font-medium">{formatGold(it.total)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
