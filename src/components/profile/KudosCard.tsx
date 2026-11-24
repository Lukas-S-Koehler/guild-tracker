'use client';

import { useEffect, useState } from 'react';
import { Gem, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { ReceivedKudos, GiverStatus } from '@/lib/kudos';

const MIN = 3;
const MAX = 200;
const ago = (iso: string) => {
  const d = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 30 ? `${d} days ago` : new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

/** Kudos received by this account + a "give kudos" form for other members (step 14, F7). */
export default function KudosCard({ ign, initial, isSelf, accountIgns }: { ign: string; initial: ReceivedKudos; isSelf: boolean; accountIgns: string[] }) {
  const [kudos, setKudos] = useState(initial);
  const [status, setStatus] = useState<GiverStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (isSelf) return;
    fetch('/api/kudos', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then(setStatus)
      .catch(() => setStatus(null));
  }, [isSelf]);

  const lower = new Set(accountIgns.map((n) => n.toLowerCase()));
  const givenHere = status?.given.find((k) => lower.has(k.recipient_ign.toLowerCase()));
  const len = reason.trim().length;

  async function send() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch('/api/kudos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ign, reason }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg({ ok: false, text: j.error ?? 'Failed to send' });
        return;
      }
      setMsg({ ok: true, text: `Kudos sent. ${j.remaining} left this week.` });
      setKudos((k) => ({
        ...k,
        total: k.total + 1,
        this_week: k.this_week + 1,
        recent: [{ from_ign: 'You', to_ign: j.kudos.recipient_ign, reason: j.kudos.reason, at: j.kudos.created_at }, ...k.recent].slice(0, 8),
      }));
      setStatus((s) => (s ? { ...s, remaining: j.remaining, given: [...s.given, j.kudos] } : s));
      setReason('');
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Gem className="h-4 w-4 text-crystal-light" />
          Kudos
          <span className="text-sm font-normal text-muted-foreground">
            {kudos.total ? `${kudos.total} from ${kudos.givers} member${kudos.givers === 1 ? '' : 's'}` : 'none yet'}
          </span>
          {!isSelf && status?.can_give && !open && !givenHere && status.remaining > 0 && (
            <Button size="sm" variant="outline" className="ml-auto" onClick={() => setOpen(true)}>
              💎 Give kudos
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!isSelf && status && !open && (
          <p className="text-xs text-muted-foreground">
            {!status.can_give
              ? 'Claim your character to give kudos.'
              : givenHere
                ? `You thanked them this week: “${givenHere.reason}”`
                : status.remaining === 0
                  ? `You've used all ${status.per_week} kudos this week. New ones on Monday.`
                  : `${status.remaining} of ${status.per_week} kudos left this week. One per person per week.`}
          </p>
        )}

        {open && (
          <div className="space-y-2">
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value.slice(0, MAX))}
              placeholder={`What are you thanking ${ign} for?`}
              rows={2}
              autoFocus
            />
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{len}/{MAX}</span>
              <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setOpen(false)} disabled={busy}>
                Cancel
              </Button>
              <Button size="sm" onClick={send} disabled={busy || len < MIN}>
                {busy && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                Send kudos
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Shows on their profile and in the weekly shoutout in #hall-of-fame.</p>
          </div>
        )}
        {msg && <p className={`text-sm ${msg.ok ? 'text-green-500' : 'text-red-500'}`}>{msg.text}</p>}

        {kudos.recent.length > 0 ? (
          <ul className="space-y-2">
            {kudos.recent.map((k, i) => (
              <li key={i} className="text-sm border-l-2 border-crystal/40 pl-3">
                <p className="break-words">“{k.reason}”</p>
                <p className="text-xs text-muted-foreground">
                  {k.from_ign} · {ago(k.at)}
                  {accountIgns.length > 1 && ` · to ${k.to_ign}`}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            {isSelf ? 'No kudos yet. Thank someone with /kudos give in Discord or on their profile.' : 'Be the first to thank them.'}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
