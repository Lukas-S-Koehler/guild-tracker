'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, Check, ExternalLink, Eye, Loader2, Pause, Play, RefreshCw, Unlink } from 'lucide-react';

/**
 * Admin → Discord → Live messages. Bind each DreamBot live post to a channel, update or
 * repost it, pause it, or preview what would be posted. Backed by /api/admin/discord-live.
 */
interface Item {
  key: string;
  label: string;
  description: string;
  channel: string | null;
  mode: 'edit' | 'repost';
  source: 'build' | 'auto-warn' | 'guild-hall';
  guild_active?: boolean;
  pings?: boolean;
  buildable: boolean;
  bound: boolean;
  channel_id: string | null;
  enabled: boolean;
  message_count: number;
  link: string | null;
  last_published_at: string | null;
  last_error: string | null;
}

interface Payload { content?: string; embeds?: Array<{ title?: string; description?: string; fields?: Array<{ name: string; value: string }> }> }

function previewText(p: Payload[]): string {
  return p
    .map((m, i) => {
      const parts = [`── message ${i + 1} ──`];
      if (m.content) parts.push(m.content);
      for (const e of m.embeds ?? []) {
        if (e.title) parts.push(`[embed] ${e.title}`);
        if (e.description) parts.push(e.description);
        for (const f of e.fields ?? []) parts.push(`▸ ${f.name}\n${f.value}`);
      }
      return parts.join('\n');
    })
    .join('\n\n');
}

const ago = (iso: string | null) => {
  if (!iso) return 'never';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 60) return `${m} min ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} days ago`;
};

async function post(body: Record<string, unknown>) {
  const res = await fetch('/api/admin/discord-live', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || d.ok === false) throw new Error(d.error ?? `Failed (${res.status})`);
  return d as { status?: string; note?: string };
}

function LiveCard({ item, onChange }: { item: Item; onChange: () => void }) {
  const [channel, setChannel] = useState(item.channel_id ?? item.channel ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  async function run(label: string, body: Record<string, unknown>, done: (d: { status?: string; note?: string }) => string) {
    setBusy(label);
    setMsg(null);
    try {
      const d = await post({ key: item.key, ...body });
      setMsg({ ok: true, text: done(d) });
      onChange();
    } catch (err) {
      setMsg({ ok: false, text: String(err instanceof Error ? err.message : err) });
    } finally {
      setBusy(null);
    }
  }

  async function loadPreview() {
    if (preview !== null) return setPreview(null);
    setBusy('preview');
    try {
      const res = await fetch(`/api/admin/discord-live?preview=${encodeURIComponent(item.key)}`);
      const d = await res.json();
      setPreview(d.payloads?.length ? previewText(d.payloads) : 'Nothing yet: produced by the daily activity check.');
    } catch {
      setPreview('Preview failed.');
    } finally {
      setBusy(null);
    }
  }

  const statusText = (s?: string) => (s === 'unchanged' ? 'No changes, nothing edited.' : s === 'published' ? 'Posted.' : s ?? 'Done.');
  const moved = item.bound && channel.trim() !== item.channel_id;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-1">
            <CardTitle className="text-base flex items-center gap-2">
              {item.label}
              {!item.bound ? (
                <Badge variant="outline">not bound</Badge>
              ) : item.enabled ? (
                <Badge className="bg-crystal/20 text-crystal border-crystal/30">live</Badge>
              ) : (
                <Badge variant="secondary">paused</Badge>
              )}
              {item.guild_active === false && <Badge variant="secondary">guild inactive · no reports</Badge>}
              <Badge variant="outline" className="font-normal">{item.mode === 'edit' ? 'edited in place' : 'reposted daily'}</Badge>
            </CardTitle>
            <CardDescription>{item.description}</CardDescription>
          </div>
          {item.link && (
            <a href={item.link} target="_blank" rel="noreferrer" className="text-sm text-crystal inline-flex items-center gap-1 hover:underline">
              Open in Discord <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input value={channel} onChange={(e) => setChannel(e.target.value)} placeholder="Channel id" className="w-56 font-mono text-xs" />
          {(!item.bound || moved) && (
            <Button
              size="sm"
              disabled={!!busy || !channel.trim()}
              onClick={() => run('bind', { action: 'bind', channel_id: channel.trim() }, (d) => d.note ?? statusText(d.status))}
            >
              {busy === 'bind' && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
              {moved ? 'Move here' : item.buildable ? 'Bind & post' : 'Bind'}
            </Button>
          )}
          {item.bound && !moved && (
            <>
              <Button size="sm" variant="outline" disabled={!!busy} onClick={() => run('publish', { action: 'publish', force: true }, (d) => statusText(d.status))}>
                {busy === 'publish' ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                {item.mode === 'edit' ? 'Update now' : 'Repost last'}
              </Button>
              <Button size="sm" variant="outline" disabled={!!busy} onClick={() => run('toggle', { action: 'toggle', enabled: !item.enabled }, () => (item.enabled ? 'Paused.' : 'Resumed.'))}>
                {item.enabled ? <Pause className="h-3 w-3 mr-1" /> : <Play className="h-3 w-3 mr-1" />}
                {item.enabled ? 'Pause' : 'Resume'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!!busy}
                onClick={() => {
                  if (!confirm(`Unbind "${item.label}" and delete its ${item.message_count} Discord message(s)?`)) return;
                  run('unbind', { action: 'unbind', delete_messages: true }, () => 'Unbound, messages deleted.');
                }}
              >
                <Unlink className="h-3 w-3 mr-1" /> Unbind
              </Button>
            </>
          )}
          <Button size="sm" variant="ghost" disabled={!!busy} onClick={loadPreview}>
            {busy === 'preview' ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Eye className="h-3 w-3 mr-1" />}
            {preview !== null ? 'Hide preview' : 'Preview'}
          </Button>
        </div>
        {item.pings !== undefined && (
          <label className="flex items-center gap-2 text-sm cursor-pointer w-fit">
            <input
              type="checkbox"
              className="rounded"
              checked={item.pings}
              disabled={!!busy}
              onChange={(e) => run('pings', { action: 'pings', enabled: e.target.checked }, () => (e.target.checked ? '@mentions on.' : '@mentions off.'))}
            />
            @mention flagged members in the report
          </label>
        )}
        {item.bound && (
          <p className="text-xs text-muted-foreground">
            {item.message_count} message{item.message_count === 1 ? '' : 's'} · last posted {ago(item.last_published_at)}
            {item.source === 'auto-warn' && ' · updated by the daily activity check'}
            {item.source === 'guild-hall' && ' · updated daily at 15:50 UTC'}
          </p>
        )}
        {item.last_error && (
          <p className="text-xs text-destructive flex items-start gap-1"><AlertCircle className="h-3 w-3 mt-0.5 shrink-0" /> {item.last_error}</p>
        )}
        {msg && (
          <p className={`text-sm flex items-start gap-1.5 ${msg.ok ? 'text-green-500' : 'text-destructive'}`}>
            {msg.ok ? <Check className="h-3.5 w-3.5 mt-0.5 shrink-0" /> : <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />}
            {msg.text}
          </p>
        )}
        {preview !== null && (
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-xs font-mono">{preview}</pre>
        )}
      </CardContent>
    </Card>
  );
}

export default function LiveMessagesPanel() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/discord-live', { cache: 'no-store' });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? `Failed (${res.status})`);
      setItems(d.items);
      setError(null);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!items) return <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  const main = items.filter((i) => !i.key.startsWith('inactivity:') && !i.key.startsWith('guild-hall:'));
  const reports = items.filter((i) => i.key.startsWith('inactivity:'));
  const halls = items.filter((i) => i.key.startsWith('guild-hall:'));

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        DreamBot posts that stay current instead of piling up. Nothing is posted until you bind a channel.
        Reference posts are rebuilt daily after the activity check and only edited when something changed; daily reports replace yesterday&apos;s copy.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        {main.map((i) => <LiveCard key={i.key} item={i} onChange={load} />)}
      </div>
      <h3 className="text-sm font-semibold pt-2">Per-guild inactivity reports</h3>
      <p className="text-xs text-muted-foreground">Unbound or paused = no report for that guild. Inactive guilds get no report (the activity check skips them).</p>
      <div className="grid gap-4 lg:grid-cols-2">
        {reports.map((i) => <LiveCard key={i.key} item={i} onChange={load} />)}
      </div>
      <h3 className="text-sm font-semibold pt-2">Guild hall stockpile</h3>
      <p className="text-xs text-muted-foreground">Needs the guild&apos;s API key and active buildings in Admin → Guilds. Guilds bound under the old setting were moved here automatically.</p>
      <div className="grid gap-4 lg:grid-cols-2">
        {halls.map((i) => <LiveCard key={i.key} item={i} onChange={load} />)}
      </div>
    </div>
  );
}
